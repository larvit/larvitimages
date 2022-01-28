// import { Log, Utils } from 'larvitutils';
import { Log } from 'larvitutils';
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

const tmpFolder = path.join(os.tmpdir(), 'larvitimages_test');
// const lUtils = new Utils();
const log = new Log('debug');

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
	// await new Promise(res => rimraf(__dirname + '/../larvitimages', res));
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

describe('LarvitImages', () => {
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

	// it('should get only binary by slug with custom height and width', done => {
	// 	const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
	// 	const options = {};
	// 	const tasks = [];

	// 	const saveObj = { file: { name: 'testimage8.jpg' } };

	// 	// Create testimage
	// 	tasks.push(cb => {
	// 		new Jimp(256, 256, 0xFF0000FF, (err, image) => {
	// 			if (err) throw err;

	// 			image.getBuffer(Jimp.MIME_JPEG, (err, result) => {
	// 				if (err) throw err;
	// 				saveObj.file.bin = result;
	// 				cb();
	// 			});
	// 		});
	// 	});

	// 	// Save test image
	// 	tasks.push(cb => {
	// 		img.saveImage(saveObj, (err, image) => {
	// 			if (err) throw err;
	// 			saveObj.uuid = image.uuid;
	// 			cb();
	// 		});
	// 	});

	// 	// Get saved image binary and write to tmp file
	// 	tasks.push(cb => {
	// 		options.slug = saveObj.file.name;
	// 		options.width = 500;
	// 		options.height = 750;

	// 		img.getImageBin(options, (err, image) => {
	// 			if (err) throw err;

	// 			fs.writeFile(tmpFileName, image, err => {
	// 				if (err) throw err;
	// 				cb(err);
	// 			});
	// 		});
	// 	});

	// 	// Open tmp file and check
	// 	tasks.push(cb => {
	// 		Jimp.read(tmpFileName, (err, image) => {
	// 			if (err) throw err;

	// 			assert.strictEqual(options.width, image.bitmap.width);
	// 			assert.strictEqual(options.height, image.bitmap.height);
	// 			cb(err);
	// 		});
	// 	});

	// 	// Delete tmp file
	// 	tasks.push(cb => {
	// 		fs.unlink(tmpFileName, err => {
	// 			if (err) throw err;
	// 			cb(err);
	// 		});
	// 	});

	// 	async.series(tasks, err => {
	// 		if (err) throw err;
	// 		done();
	// 	});
	// });

	// it('should clear cached image based on slug', done => {
	// 	const tmpFileName = os.tmpdir() + '/' + uuidLib.v1() + '.jpg';
	// 	const options = {};
	// 	const tasks = [];

	// 	const saveObj = { file: { name: 'testimage9.jpg' } };

	// 	// Create testimage
	// 	tasks.push(cb => {
	// 		new Jimp(256, 256, 0xFF0000FF, (err, image) => {
	// 			if (err) throw err;

	// 			image.getBuffer(Jimp.MIME_JPEG, (err, result) => {
	// 				if (err) throw err;
	// 				saveObj.file.bin = result;
	// 				cb();
	// 			});
	// 		});
	// 	});

	// 	// Save test image
	// 	tasks.push(cb => {
	// 		img.saveImage(saveObj, (err, image) => {
	// 			if (err) throw err;
	// 			saveObj.uuid = image.uuid;
	// 			cb();
	// 		});
	// 	});

	// 	// Get saved image
	// 	tasks.push(cb => {
	// 		options.slug = saveObj.file.name;
	// 		options.width = 400;
	// 		options.height = 400;

	// 		img.getImageBin(options, (err, image) => {
	// 			if (err) throw err;

	// 			fs.writeFile(tmpFileName, image, err => {
	// 				if (err) throw err;
	// 				cb(err);
	// 			});
	// 		});
	// 	});

	// 	// Open tmp file and check
	// 	tasks.push(cb => {
	// 		Jimp.read(tmpFileName, (err, image) => {
	// 			if (err) throw err;

	// 			assert.strictEqual(options.width, image.bitmap.width);
	// 			assert.strictEqual(options.height, image.bitmap.height);
	// 			cb(err);
	// 		});
	// 	});

	// 	// Clear created image cached
	// 	tasks.push(cb => {
	// 		const options = { slug: saveObj.file.name };

	// 		img.clearCache(options, err => {
	// 			if (err) throw err;
	// 			cb();
	// 		});
	// 	});

	// 	// Check if cached image is deleted
	// 	tasks.push(cb => {
	// 		const uuid = lUtils.formatUuid(saveObj.uuid);
	// 		const path = img.cacheDir + '/' + uuid.substr(0, 4).split('').join('/') + '/' + uuid + '_w400_h400.jpg';

	// 		fs.stat(path, err => {
	// 			assert(err);
	// 			cb();
	// 		});
	// 	});

	// 	async.series(tasks, err => {
	// 		if (err) throw err;
	// 		done();
	// 	});
	// });

	// it('Should convert gifs to png when saved', done => {
	// 	const tasks = [];
	// 	const saveObj = {
	// 		file:	{ path: __dirname + '/flanders.gif' },
	// 		slug:	'flanders.gif',
	// 	};

	// 	let uuid = null;

	// 	// Save test image
	// 	tasks.push(cb => {
	// 		img.saveImage(saveObj, (err, image) => {
	// 			if (err) throw err;

	// 			assert.strictEqual(image.type, 'png');
	// 			assert.notStrictEqual(image.uuid, undefined);
	// 			assert.strictEqual(image.slug, 'flanders.png');

	// 			uuid = image.uuid;
	// 			cb();
	// 		});
	// 	});

	// 	// Get image data
	// 	tasks.push(cb => {
	// 		const options = {
	// 			uuid: uuid,
	// 			width: 400,
	// 			height: 400,
	// 		};

	// 		img.getImageBin(options, (err, data) => {
	// 			assert.notStrictEqual(data, undefined);
	// 			cb(err);
	// 		});
	// 	});

	// 	async.series(tasks, done);
	// });
});
