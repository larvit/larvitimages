import { Log, Utils } from 'larvitutils';
import assert from 'assert';
import Db from 'larvitdb';
import fs from 'fs';
import Jimp from 'jimp';
import mkdirp from 'mkdirp';
import os from 'os';
import path from 'path';
import rimraf from 'rimraf';
import * as uuidLib from 'uuid';

import { ImgLib } from '../src/index';
import { DataWriter } from '../src/dataWriter';

const tmpFolder = path.join(os.tmpdir(), 'larvitimages_test');
const lUtils = new Utils();
const log = new Log('error');

let db: any;
let img: ImgLib;

before(async () => {
	// Run DB Setup
	const confFile = process.env.DBCONFFILE || __dirname + '/../config/db_test.json';
	log.verbose('DB config file: "' + confFile + '"');

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const config = require(confFile);
	log.verbose('DB config: ' + JSON.stringify(config));

	db = new Db({ log, ...config });
});

after(async () => {
	await db.removeAllTables();
	await new Promise(res => rimraf(tmpFolder, res));
});

beforeEach(async () => {
	await db.removeAllTables();

	// Create tmp folder
	await mkdirp(tmpFolder);

	img = new ImgLib({ db: db, log: log, storagePath: tmpFolder });
	await img.migrateDb();
});

afterEach(async () => {
	await new Promise(res => rimraf(tmpFolder, res));
});

describe('Datawriter', () => {
	it('rmImage should throw an error if uuid is invalid', async () => {
		const dw = new DataWriter({ db, log, lUtils });
		await assert.rejects(async () => await dw.rmImage('korv'));
	});

	it('saveImage should throw an error if uuid is invalid', async () => {
		const dw = new DataWriter({ db, log, lUtils });
		await assert.rejects(async () => await dw.saveImage({ uuid: 'korv' }));
	});

	it('saveImage with existing slug should throw an error', async () => {
		const dw = new DataWriter({ db, log, lUtils });
		const slug = 'korv';
		await dw.saveImage({ slug, uuid: uuidLib.v4() });
		await assert.rejects(async () => await dw.saveImage({ slug, uuid: uuidLib.v4() }));
	});
});

describe('LarvitImages', () => {
	describe('General', () => {
		it('ImgLib should throw an error if db is not specified in the constructor options', () => {
			assert.throws(() => new ImgLib({ db: undefined }));
		});

		it('ImgLib should construct without log being specified', () => {
			assert.doesNotThrow(() => new ImgLib({ db, log: undefined }));
		});

		it('ImgLib should create a default storage path if not specified', () => {
			const imgLib = new ImgLib({ db });
			assert.strictEqual(imgLib.storagePath, `${path.join(process.cwd(), '/larvitimages')}`);
		});

		it('createImageDirectory should throw an error if uuid is invalid', async () => {
			await assert.rejects(async () => await img.createImageDirectory('korv'));
		});

		it('getPathToImage should return empty string if uuid is unspecified or not a string', () => {
			assert.strictEqual(img.getPathToImage(undefined as any), '');
			assert.strictEqual(img.getPathToImage(12 as any), '');
		});

		it('clearCache on non-existing slug should be ok', async () => {
			await assert.doesNotReject(async () => await img.clearCache({ slug: 'korv' }));
		});

		it('clearCache should throw error on bad uuid', async () => {
			await assert.rejects(async () => await img.clearCache({ uuid: 'korv' }));
		});

		it('getImageBin should throw error if both uuid and slug are unspecified', async () => {
			await assert.rejects(async () => await img.getImageBin({ uuid: undefined, slug: undefined }));
		});

		it('rmImage should throw error if uuid is invalid', async () => {
			await assert.rejects(async () => await img.rmImage('asdf'));
		});

		it('saveImage should throw error if file is undefined', async () => {
			await assert.rejects(async () => await img.saveImage({ file: undefined }));
		});
	});

	it('should save an image in database', async () => {
		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		const bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage({ file: { name: 'testimage1.jpg', bin } });
		const uuid = savedImage.uuid;

		// Get saved image
		const { images, totalElements } = await img.getImages({ uuids: [uuid], includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(totalElements, 1);
		assert.strictEqual(Buffer.compare(image.image, bin), 0);
		assert.strictEqual(image.slug, 'testimage1.jpg');
	});

	it('should save an image in database with metadata', async () => {
		const saveObj =
			{
				file: {
					name: 'testimage1_1.jpg',
					bin: Buffer.of(0),
				},
				metadata: [
					{
						name: 'deer',
						data: 'tasty',
					},
					{
						name: 'frog',
						data: 'disgusting',
					},
				],
			};

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		const bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);
		saveObj.file.bin = bin;

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Get saved image
		const { images, totalElements } = await img.getImages({ uuids: [savedImage.uuid], includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(totalElements, 1);
		assert.strictEqual(Buffer.compare(image.image, saveObj.file.bin), 0);
		assert.strictEqual(saveObj.file.name, image.slug);
		assert.deepStrictEqual(saveObj.metadata[0], image.metadata[0]);
		assert.deepStrictEqual(saveObj.metadata[1], image.metadata[1]);
	});

	it('should remove image', async () => {
		const saveObj = { file: { name: 'testimage2.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Remove image
		await img.rmImage(savedImage.uuid);

		// Get saved image to see if it's gone
		const { images, totalElements } = await img.getImages({ uuids: [savedImage.uuid], includeBinaryData: true });
		assert.strictEqual(totalElements, 0);
		assert.strictEqual(Object.keys(images).length, 0);
	});

	it('should get image by uuid', async () => {
		const saveObj = { file: { name: 'testimage3.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Get saved image
		const { images, totalElements } = await img.getImages({ uuids: [savedImage.uuid], includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(Buffer.compare(saveObj.file.bin, image.image), 0);
		assert.strictEqual(saveObj.file.name, image.slug);
		assert.strictEqual(totalElements, 1);
	});

	it('should get image by slug', async () => {
		const saveObj = { file: { name: 'testimage4.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Get saved image
		const { images } = await img.getImages({ slugs: [savedImage.slug], includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(Buffer.compare(image.image, saveObj.file.bin), 0);
		assert.strictEqual(saveObj.file.name, image.slug);
	});

	it('should get image by query', async () => {
		const saveObj = { file: { name: 'testimage55.jpg', bin: Buffer.of(0) }, metadata: [
			{
				name: 'party',
				data: 'fun',
			},
			{
				name: 'work',
				data: 'boring',
			},
		] };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		await img.saveImage(saveObj);

		// Get saved image
		const { images } = await img.getImages({ q: 'ring', includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(Buffer.compare(image.image, saveObj.file.bin), 0);
		assert.strictEqual(saveObj.file.name, image.slug);
	});

	it('should get image by metadata filter', async () => {
		const saveObj1 = {
			file: { name: 'img1.jpg', bin: Buffer.of(0) }, metadata: [
				{
					name: 'label',
					data: 'EIN-LABEL',
				},
				{
					name: 'category',
					data: '1',
				},
			],
		};

		const saveObj2 = {
			file: { name: 'img2.jpg', bin: Buffer.of(0) }, metadata: [
				{
					name: 'label',
					data: 'EIN-LABEL',
				},
				{
					name: 'category',
					data: '2',
				},
			],
		};

		// Create testimages
		const testImage1 = new Jimp(256, 256, 0xFF0000FF);
		saveObj1.file.bin = await testImage1.getBufferAsync(Jimp.MIME_JPEG);

		const testImage2 = new Jimp(256, 256, 0xB00B00FF);
		saveObj2.file.bin = await testImage2.getBufferAsync(Jimp.MIME_JPEG);

		// Save test images
		await img.saveImage(saveObj1);
		await img.saveImage(saveObj2);

		// Get images by metadata filter expect two matches
		const { images: imagesLabel } = await img.getImages({ metadata: { label: 'EIN-LABEL' } });
		assert.equal(Object.keys(imagesLabel).length, 2);

		// Get images by metadata filter expect one matches
		const { images: imagesCat } = await img.getImages({ metadata: { category: '1' } });
		assert.equal(Object.keys(imagesCat).length, 1);
		assert.equal(imagesCat[Object.keys(imagesCat)[0]].slug, 'img1.jpg');

		// Expect error when getting on more than 60 metadata fields
		const options: { metadata: Record<string, string> } = {
			metadata: {
			},
		};

		for (let i = 0; i < 61; ++i) {
			options.metadata['name' + i] = 'data';
		}

		await assert.rejects(async () => await img.getImages(options));
	});

	it('should get only binary by slug', async () => {
		const saveObj = { file: { name: 'testimage5.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		await img.saveImage(saveObj);

		// Get saved image
		const { imgBuf } = await img.getImageBin({ slug: saveObj.file.name });
		assert.strictEqual(Buffer.compare(imgBuf, saveObj.file.bin), 0);
	});

	it('should get only binary by slug with custom height', async () => {
		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj = { file: { name: 'testimage6.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		await img.saveImage(saveObj);

		// Get saved image bin
		const { imgBuf } = await img.getImageBin({ slug: saveObj.file.name, height: 500 });
		await fs.promises.writeFile(tmpFileName, imgBuf);

		// Open tmp file and check
		const tmpImage = await Jimp.read(tmpFileName);
		assert.strictEqual(tmpImage.bitmap.height, 500);
		assert.strictEqual(tmpImage.bitmap.width, 500);

		// Delete tmp file
		await fs.promises.unlink(tmpFileName);
	});

	it('should get only binary by slug with custom width', async () => {
		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj = { file: { name: 'testimage7.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		await img.saveImage(saveObj);

		// Get saved image binary and write to tmp file
		const { imgBuf } = await img.getImageBin({ slug: saveObj.file.name, width: 500 });
		await fs.promises.writeFile(tmpFileName, imgBuf);

		// Open tmp file and check
		const tmpImage = await Jimp.read(tmpFileName);
		assert.strictEqual(tmpImage.bitmap.height, 500);
		assert.strictEqual(tmpImage.bitmap.width, 500);

		// Delete tmp file
		await fs.promises.unlink(tmpFileName);
	});

	it('should get only binary by slug with custom height and width', async () => {
		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj = { file: { name: 'testimage8.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		await img.saveImage(saveObj);

		// Get saved image binary and write to tmp file

		const { imgBuf } = await img.getImageBin({
			slug: saveObj.file.name,
			width: 500,
			height: 750,
		});

		await fs.promises.writeFile(tmpFileName, imgBuf);

		// Open tmp file and check
		const tmpImage = await Jimp.read(tmpFileName);

		assert.strictEqual(tmpImage.bitmap.width, 500);
		assert.strictEqual(tmpImage.bitmap.height, 750);

		// Delete tmp file
		await fs.promises.unlink(tmpFileName);
	});

	it('should clear cached image based on slug', async () => {
		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Get saved image
		const { imgBuf } = await img.getImageBin({
			slug: saveObj.file.name,
			width: 400,
			height: 400,
		});

		await fs.promises.writeFile(tmpFileName, imgBuf);

		// Open tmp file and check
		const tmpImage = await Jimp.read(tmpFileName);
		assert.strictEqual(tmpImage.bitmap.width, 400);
		assert.strictEqual(tmpImage.bitmap.height, 400);

		// Clear created image cached
		await img.clearCache({ slug: saveObj.file.name });

		// Check if cached image is deleted
		const uuid = lUtils.formatUuid(savedImage.uuid) as string;
		const path = img.cacheDir + '/' + uuid.substring(0, 4).split('').join('/') + '/' + uuid + '_w400_h400.jpg';

		await assert.rejects(async () => await fs.promises.stat(path));
	});

	it('should clear all cached images', async () => {
		const tmpFileName1 = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const tmpFileName2 = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj1 = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		const saveObj2 = { file: { name: 'testimage19.jpg', bin: Buffer.of(0) } };

		// Create testimage
		saveObj1.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);
		saveObj2.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage1 = await img.saveImage(saveObj1);
		const savedImage2 = await img.saveImage(saveObj2);

		// Get saved image
		const { imgBuf: imgBuf1 } = await img.getImageBin({
			slug: saveObj1.file.name,
			width: 400,
			height: 400,
		});
		const { imgBuf: imgBuf2 } = await img.getImageBin({
			slug: saveObj2.file.name,
			width: 400,
			height: 400,
		});

		await fs.promises.writeFile(tmpFileName1, imgBuf1);
		await fs.promises.writeFile(tmpFileName2, imgBuf2);

		// Open tmp file and check
		const tmpImage1 = await Jimp.read(tmpFileName1);
		const tmpImage2 = await Jimp.read(tmpFileName2);
		assert.strictEqual(tmpImage1.bitmap.width, 400);
		assert.strictEqual(tmpImage2.bitmap.height, 400);

		// Clear created image cached
		await img.clearCache({ clearAll: true });

		// Check if cached image is deleted
		const uuid1 = lUtils.formatUuid(savedImage1.uuid) as string;
		const uuid2 = lUtils.formatUuid(savedImage2.uuid) as string;
		const path1 = img.cacheDir + '/' + uuid1.substring(0, 4).split('').join('/') + '/' + uuid1 + '_w400_h400.jpg';
		const path2 = img.cacheDir + '/' + uuid2.substring(0, 4).split('').join('/') + '/' + uuid2 + '_w400_h400.jpg';

		await assert.rejects(async () => await fs.promises.stat(path1));
		await assert.rejects(async () => await fs.promises.stat(path2));
	});

	it('should convert gifs to png when saved', async () => {
		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const saveObj = {
			file: { path: __dirname + '/flanders.gif' },
			slug: 'flanders.gif',
			bin: Buffer.of(0),
		};

		// Save test image
		const savedImage = await img.saveImage(saveObj);
		assert.strictEqual(savedImage.type, 'png');
		assert.notStrictEqual(savedImage.uuid, undefined);
		assert.strictEqual(savedImage.slug, 'flanders.png');

		// Get image data
		const options = {
			uuid: savedImage.uuid,
			width: 400,
			height: 400,
		};

		const { imgBuf } = await img.getImageBin(options);
		assert.notStrictEqual(imgBuf, undefined);

		await fs.promises.writeFile(tmpFileName, imgBuf);

		const tmpImage = await Jimp.read(tmpFileName);
		assert.strictEqual(tmpImage.getExtension(), 'png');
	});

	it('should throw error when getImageBin cannot find any images for speficied uuid or slug', async () => {
		await assert.rejects(async () => await img.getImageBin({ uuid: uuidLib.v4(), slug: undefined }));
		await assert.rejects(async () => await img.getImageBin({ slug: 'korv' }));
	});

	it('should throw error when width or height is not a number in getImageBin', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);
		const savedImage = await img.saveImage(saveObj);

		await assert.rejects(async () => img.getImageBin({ uuid: savedImage.uuid, width: 'tjugo' as any }));
		await assert.rejects(async () => img.getImageBin({ uuid: savedImage.uuid, height: 'tjugo' as any }));
	});

	it('should not get any images when slug is empty string', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);
		const savedImage = await img.saveImage(saveObj);

		const result = await img.getImages({ uuids: savedImage.uuid, slugs: [] });
		assert.strictEqual(Object.keys(result.images).length, 0);
	});

	it('should ignore bad uuids when getting images', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);
		const savedImage = await img.saveImage(saveObj);

		const { images } = await img.getImages({ uuids: ['asdf', savedImage.uuid, 'korv'] });
		assert.strictEqual(Object.keys(images).length, 1);
		assert.strictEqual(Object.keys(images)[0], savedImage.uuid);
	});

	it('saveImage should throw when trying to save something where image type cannot be determined', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.from('This is not an image') } };
		await assert.rejects(async () => await img.saveImage(saveObj), new Error('Could not determine image type from data, can not save'));
	});

	it('saveImage should throw when trying to save something without file path and file bin', async () => {
		const saveObj = { file: { name: 'no_paht_or_bin' } };
		await assert.rejects(async () => await img.saveImage(saveObj), new Error('Neither binary data or file path was given, can not save'));
	});

	it('saveImage should throw for unsupported image format', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_BMP);

		await assert.rejects(async () => await img.saveImage(saveObj), new Error('Invalid file format, must be of image type PNG, JPEG or GIF'));
	});

	it('saveImage should throw when trying to save a new image with an existing slug', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_PNG);

		const savedImage = await img.saveImage(saveObj);
		await assert.rejects(async () => await img.saveImage({
			...saveObj,
			slug: savedImage.slug,
			uuid: uuidLib.v4(),
		}), new Error('Slug: "testimage9.jpg" is used by another image entry, try setting another one manually.'));
	});

	it('saveImage should overwrite image data when saving with same slug and uuid', async () => {
		const saveObj = { file: { name: 'testimage9.jpg', bin: Buffer.of(0) } };
		saveObj.file.bin = await new Jimp(256, 256, 0xFF0000FF).getBufferAsync(Jimp.MIME_PNG);

		const savedImage = await img.saveImage(saveObj);
		saveObj.file.bin = await new Jimp(128, 128, 0xFF0000FF).getBufferAsync(Jimp.MIME_PNG);
		await img.saveImage({ ...saveObj, uuid: savedImage.uuid, slug: savedImage.slug });

		const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
		const { imgBuf } = await img.getImageBin({ uuid: savedImage.uuid });
		await fs.promises.writeFile(tmpFileName, imgBuf);
		const tmpImage = await Jimp.read(tmpFileName);

		assert.strictEqual(tmpImage.getWidth(), 128);
		assert.strictEqual(tmpImage.getHeight(), 128);
	});

	it('should get image by identifier', async () => {
		const identifier = 'korv';
		const saveObj = { file: { name: 'testimage4.jpg', bin: Buffer.of(0) }, identifier };

		// Create testimage
		const testImage = new Jimp(256, 256, 0xFF0000FF);
		saveObj.file.bin = await testImage.getBufferAsync(Jimp.MIME_JPEG);

		// Save test image
		const savedImage = await img.saveImage(saveObj);

		// Get saved image
		const { images } = await img.getImages({ identifiers: [identifier], includeBinaryData: true });
		const image = images[Object.keys(images)[0]];
		assert.strictEqual(Buffer.compare(image.image, saveObj.file.bin), 0);
		assert.strictEqual(saveObj.file.name, image.slug);
		assert.strictEqual(savedImage.slug, image.slug);
	});
});
