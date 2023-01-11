import { DataWriter } from './dataWriter';
import { Log, LogInstance, Utils } from 'larvitutils';
import { DbMigration } from 'larvitdbmigration';
import fs from 'fs';
import imageType from 'image-type';
import jimp from 'jimp';
import mkdirp from 'mkdirp';
import os from 'os';
import path from 'path';
import { slugify } from 'larvitslugify';
import * as uuidLib from 'uuid';

const topLogPrefix = 'larvitimages: index.js:';
const lUtils = new Utils();

type Image = {
	uuid: string,
	slug: string,
	type: string,
	metadata: Array<{
		name: string,
		data: string,
		imageUuid: string,
	}>,
	image: Buffer,
};

export type ImgLibOptions = {
	db: any,
	log?: LogInstance,
	cacheDir?: string,
	storagePath?: string,
}

export class ImgLib {
	private db: any;
	private log: LogInstance;
	public cacheDir: string;
	public storagePath: string;
	private dataWriter: DataWriter;

	constructor(options: ImgLibOptions) {
		if (!options.db) {
			throw new Error('Required option db is missing');
		}

		this.db = options.db;
		this.log = options.log ?? new Log();
		this.cacheDir = options.cacheDir ?? path.join(os.tmpdir(), '/larvitimages_cache');
		this.storagePath = options.storagePath ?? path.join(process.cwd(), '/larvitimages');
		this.dataWriter = new DataWriter({
			log: this.log,
			db: options.db,
			lUtils,
		});
	}

	async migrateDb(): Promise<void> {
		const { db, log } = this;
		const dbMigration = new DbMigration({
			dbType: 'mariadb',
			dbDriver: db,
			tableName: 'images_db_version',
			migrationScriptPath: `${__dirname}/../dbmigration`,
			log: log,
			context: {
				imgLib: this,
			},
		});

		await dbMigration.run();
	}

	getPathToImage(uuid: string, useCache?: boolean): string {
		const { cacheDir, storagePath } = this;

		if (!this.isValidUuid(uuid)) return '';

		if (useCache) {
			return cacheDir + '/' + uuid.substr(0, 4).split('').join('/') + '/';
		} else {
			return storagePath + '/' + uuid.substr(0, 4).split('').join('/') + '/';
		}
	}

	isValidUuid(uuid: string): boolean {
		if (!uuid || typeof uuid !== 'string' || String(uuid).match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/) === null) {
			return false;
		}

		return true;
	}

	async createImageDirectory(uuid: string, useCache?: boolean): Promise<string> {
		const { log } = this;
		const logPrefix = `${topLogPrefix} createImageDirectory() -`;

		if (!this.isValidUuid(uuid)) {
			const err = new Error('Invalid uuid');
			log.warn(`${logPrefix} ${err.message}`);

			throw err;
		}

		const path = this.getPathToImage(uuid, useCache);

		// Should not happen since we verify the uuid above
		/* istanbul ignore if */
		if (!path) {
			const err = new Error('Could not get path to file with uuid: "' + uuid + '"');
			log.warn(`${logPrefix} ${err.message}`);

			throw err;
		}

		if (!fs.existsSync(path)) {
			try {
				await mkdirp(path);
				log.debug(`${logPrefix} Folder "${path}" created`);
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				log.error(`${logPrefix} Could not create folder: "${path}" err: ${err.message}`);
				throw err;
			}
		}

		return path;
	}

	async clearCache(options: {
		slug?: string,
		uuid?: string,
		clearAll?: boolean,
	}): Promise<void> {
		const { cacheDir, log } = this;
		const logPrefix = `${topLogPrefix} clearCache() -`;

		options.clearAll = options.clearAll || (!options.slug && !options.uuid);

		if (options.clearAll) {
			await fs.promises.rm(cacheDir, { recursive: true, force: true });
		} else {
			// If no uuid is given get image data by slug.
			if (!options.uuid) {

				/* istanbul ignore if */
				if (!options.slug) {
					throw new Error('Slug must be specified when no uuid is specified');
				}

				const { images } = await this.getImages({ slugs: [options.slug], excludeTotalElements: true });

				if (Object.keys(images).length === 0) {
					log.warn(`${logPrefix} No image found in database with slug: ${options.slug}`);

					return;
				} else {
					options.uuid = images[Object.keys(images)[0]].uuid;
				}
			}

			// Check if the folder exists at all
			const path = this.getPathToImage(options.uuid, true);
			if (!path) {
				const err = new Error(`Could not get path to file with uuid "${options.uuid}"`);
				log.warn(`${logPrefix} ${err.message}`);
				throw err;
			}

			try {
				const stats = await fs.promises.stat(path);

				/* istanbul ignore if */
				if (!stats.isDirectory()) {
					log.warn(`${logPrefix} Path to file on filesystem is not a directory, path ${path}`);

					return;
				}
			} catch (_err) {
				const err = _err as NodeJS.ErrnoException;

				/* istanbul ignore else */
				if (err && err.code === 'ENOENT') {
					// OK if the directory already doesn't exists
					return;
				} else if (err) {
					log.error(`${logPrefix} Unknown error when fs.stat(${this.cacheDir}): ${err.message}`);
					throw err;
				}
			}

			// Remove files
			const files = await fs.promises.readdir(path);
			const tasks = [];
			for (const fileName of files) {
				if (fileName.substring(0, options.uuid.length) === options.uuid) {
					tasks.push((async (): Promise<void> => {
						try {
							await fs.promises.unlink(path + fileName);
						} catch (_err) /* istanbul ignore next */ {
							const err = _err as Error;
							log.warn(`${logPrefix} Could not remove file: "${path + fileName}", err: ${err.message}`);
							throw err;
						}
					})());
				}
			}

			await Promise.all(tasks);
		}
	}

	async getImageBin(options: {
		slug?: string,
		uuid?: string,
		width?: number,
		height?: number,
	}): Promise<{ imgBuf: Buffer, filePath: string }> {
		const logPrefix = `${topLogPrefix} getImageBin() -`;
		const { log } = this;

		if ((!options.slug && !options.uuid) || (options.slug && options.uuid)) {
			throw new Error('Must specify either slug or uuid');
		}

		const { images } = await this.getImages({ slugs: options.slug, uuids: options.uuid, excludeTotalElements: true });
		let image;

		if (!Object.keys(images).length) {
			const err = new Error(`Could not find image for slug: "${options.slug}"`);
			log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		} else {
			image = images[Object.keys(images)[0]];
		}

		const oPath = this.getPathToImage(image.uuid, false);
		const cPath = this.getPathToImage(image.uuid, true);

		/* istanbul ignore if */
		if (!oPath || !cPath) {
			const err = new Error('Could not get path to file with uuid "' + image.uuid + '"');
			log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		const uuid = image.uuid;
		const imgType = image.type;
		const originalFile = oPath + uuid + '.' + imgType;
		let cachedFile = cPath + uuid; // imgType is added later
		let fileToLoad = originalFile; // Default to fetching the original file

		// If custom width and/or height, use cached file instead
		if (options.width || options.height) {
			if (options.width) cachedFile += '_w' + options.width;
			if (options.height) cachedFile += '_h' + options.height;
			cachedFile += '.' + imgType;
			fileToLoad = cachedFile;
		}

		async function createFile(): Promise<void> {
			const locLogPrefix = `${logPrefix} createFile() -`;

			let image = await jimp.read(originalFile);

			// Should not happen
			/* istanbul ignore if */
			if (!options.width && !options.height) {
				const err = new Error('Cannot create new file without custom height or width. Should\'ve loaded the original file instead');
				log.warn(`${locLogPrefix + err.message}`);
				throw err;
			}

			const imgWidth = image.bitmap.width;
			const imgHeight = image.bitmap.height;
			const imgRatio = imgWidth / imgHeight;

			// Set the missing height or width if only one is given
			if (options.width && !options.height) {
				options.height = Math.round(options.width / imgRatio);
			}

			if (options.height && !options.width) {
				options.width = Math.round(options.height * imgRatio);
			}

			if (!lUtils.isInt(options.height) || !lUtils.isInt(options.width)) {
				const err = new Error(`Options.height or options.width is not an integer. Options: ${JSON.stringify(options)}`);
				log.warn(`${locLogPrefix + err.message}`);
				throw err;
			}

			try {
				image = await image.resize(Number(options.width), Number(options.height));
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				log.warn(`${locLogPrefix} Could not resize image, err: ${err.message}`);
				throw err;
			}

			try {
				image = await image.quality(90);
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				log.warn(`${locLogPrefix} Could not set image quality to 90, err: ${err.message}`);
				throw err;
			}

			try {
				await mkdirp(path.dirname(cachedFile));
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				if (err.message.substring(0, 6) !== 'EEXIST') {
					log.warn(`${locLogPrefix} Could not mkdirp "${path.dirname(cachedFile)}", err: ${err.message}`);
					throw err;
				}
			}

			try {
				await image.writeAsync(cachedFile);
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				log.warn(`${locLogPrefix} Could not save image, err: ${err.message}`);
			}
		}

		async function readFile(filePath: string): Promise<Buffer> {
			const imgBuf = await fs.promises.readFile(filePath);

			/* istanbul ignore if */
			if (!imgBuf) throw new Error('Did not get any buffer when reading file');

			return imgBuf;
		}

		// Check if cached file exists, and if so, return it
		let imgBuf: Buffer;
		let needsToCreateFile = false;
		try {
			imgBuf = await readFile(fileToLoad);
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (err) {
			needsToCreateFile = true;
		}

		try {
			if (needsToCreateFile) {
				await createFile();
			}

			imgBuf = await readFile(fileToLoad);
		} catch (_err) {
			const err = _err as Error;
			log.warn(logPrefix + 'Could not read file "' + fileToLoad + '", err: ' + err.message);
			throw err;
		}

		return { imgBuf, filePath: fileToLoad };
	}

	async getImages(options: {
		slugs?: string[] | string,
		uuids?: string[] | string,
		metadata?: Record<string, string>,
		limit?: number | string,
		offset?: number | string,
		includeBinaryData?: boolean,
		q?: string,
		excludeTotalElements?: boolean
	}): Promise<{ images: Record<string, Image>, totalElements?: number }> {
		const logPrefix = topLogPrefix + 'getImages() - ';
		const metadata = [];
		const images: Record<string, Image> = {};

		// Make sure options that should be arrays actually are arrays
		// This will simplify our lives in the SQL builder below
		if (options.uuids !== undefined && !Array.isArray(options.uuids)) {
			options.uuids = [options.uuids];
		}
		if (options.slugs !== undefined && !Array.isArray(options.slugs)) {
			options.slugs = [options.slugs];
		}

		// Trim slugs from slashes
		options.slugs = options.slugs?.map(x => x.replace('^/+|/+$/g', ''));

		options.limit = options.limit ?? 10;
		options.offset = options.offset ?? 0;

		const uuidBufs = options.uuids?.map(x => lUtils.uuidToBuffer(x)) ?? [];

		this.log.debug(logPrefix + 'Called with options: "' + JSON.stringify(options) + '"');

		function generateWhere(dbFields: Array<string | Buffer>): string {
			let sql = '';

			sql += 'WHERE 1 + 1\n';

			if (options.q !== undefined) {
				sql += ' AND (\n';
				sql += '   uuid IN (SELECT imageUuid FROM images_images_metadata WHERE MATCH (data) AGAINST ("?" IN BOOLEAN MODE))\n';
				sql += '   OR slug LIKE ?\n';
				sql += ')\n';
				dbFields.push('%' + options.q + '%');
				dbFields.push('%' + options.q + '%');
			}

			// Only get images with the current slugs
			if (options.slugs !== undefined) {
				const searchWithoutFileEnding = !(options.slugs as string[]).some(slug => slug.includes('.'));

				if (options.slugs.length === 0) {
					return 'WHERE 1 = 2\n';
				}

				sql += ' AND (images.slug IN (';

				for (let i = 0; options.slugs[i] !== undefined; i++) {
					sql += '?,';
					dbFields.push(options.slugs[i]);
				}

				if (searchWithoutFileEnding) {
					// Select by slug without file ending
					sql = sql.substring(0, sql.length - 1) + ') OR SUBSTRING(images.slug, 1, CHAR_LENGTH(images.slug) - 1 - CHAR_LENGTH(SUBSTRING_INDEX(images.slug, \'.\', -1))) IN (';

					for (let i = 0; options.slugs[i] !== undefined; i++) {
						sql += '?,';
						dbFields.push(options.slugs[i]);
					}
				}

				sql = sql.substring(0, sql.length - 1) + '))\n';
			}

			// Only get posts with given ids
			if (options.uuids !== undefined) {
				sql += ' AND images.uuid IN (';
				for (let i = 0; uuidBufs[i] !== undefined; i++) {
					if (Buffer.isBuffer(uuidBufs[i])) {
						sql += '?,';
						dbFields.push(uuidBufs[i] as Buffer);
					} else {
						sql += '?,';
						dbFields.push('no match due to bad uuid');
					}
				}

				sql = sql.substring(0, sql.length - 1) + ')\n';
			}

			return sql;
		}

		// Get images
		const dbFields = [];

		let sql = 'SELECT images.uuid, images.slug, images.type\n';

		sql += 'FROM images_images as images\n';

		// Join on metadata
		if (options.metadata && Object.keys(options.metadata).length) {
			if (Object.keys(options.metadata).length > 60) {
				const err = new Error('Can not select on more than a total of 60 metadata key value pairs due to database limitation in joins');
				this.log.warn(`${logPrefix} ${err.message}`);
				throw err;
			}

			let counter = 0;
			for (const name of Object.keys(options.metadata)) {
				const value = options.metadata[name];
				const uniqueMetadataName = 'metadata' + ++counter;

				sql += 'JOIN images_images_metadata as ' + uniqueMetadataName;
				sql += ' ON images.uuid = ' + uniqueMetadataName + '.imageUuid';
				sql += ' AND ' + uniqueMetadataName + '.name = ?';
				sql += ' AND MATCH (' + uniqueMetadataName + '.data) AGAINST ("?" IN BOOLEAN MODE)';
				sql += '\n';

				dbFields.push(name);
				dbFields.push(value);
			}
		}

		sql += generateWhere(dbFields);
		sql += 'ORDER BY images.slug\n';

		if (options.limit) {
			sql += `LIMIT ${options.limit}\n`;
		}

		if (options.limit && options.offset !== undefined) {
			sql += ` OFFSET ${options.offset}`;
		}

		const { rows } = await this.db.query(sql, dbFields);
		for (const row of rows) {
			const uuidStr = lUtils.formatUuid(row.uuid);

			/* istanbul ignore if */
			if (typeof uuidStr === 'boolean') continue;

			images[uuidStr] = row;
			images[uuidStr].uuid = uuidStr;
			images[uuidStr].metadata = [];
		}

		// Get metadata
		if (Object.keys(images).length) {
			const dbFields = [];
			let sql = '';
			sql += 'SELECT * FROM images_images_metadata as metadata\n';
			sql += 'WHERE imageUuid IN (';
			for (const imageUuid of Object.keys(images)) {
				sql += '?,';
				dbFields.push(lUtils.uuidToBuffer(imageUuid));
			}
			sql = sql.substring(0, sql.length - 1) + ')';

			const { rows } = await this.db.query(sql, dbFields);
			for (const row of rows) {
				row.imageUuid = lUtils.formatUuid(row.imageUuid);
				metadata.push({
					data: row.data,
					imageUuid: row.imageUuid,
					name: row.name,
				});
			}
		}

		for (let i = 0; i < metadata.length; i++) {
			const imageUuid = metadata[i].imageUuid;

			/* istanbul ignore if */
			if (images[imageUuid] === undefined) {
				this.log.verbose(`${logPrefix} Image/metadata missmatch. Metadata with imageUuid "${imageUuid}" is not assosciated with any image`);
				continue;
			}

			delete metadata[i].imageUuid;
			images[imageUuid].metadata.push(metadata[i]);
		}

		if (options.excludeTotalElements) {
			return { images };
		}

		// Get total elements for pagination
		const countDbFields: string[] = [];
		const { rows: countRows } = await this.db.query('SELECT images.uuid, images.slug, COUNT(*) AS count FROM images_images AS images ' + generateWhere(countDbFields), countDbFields);
		const totalElements = countRows[0].count;

		if (options.includeBinaryData) {
			const subtasks = [];

			for (const uuid in images) {
				subtasks.push((async (): Promise<void> => {
					const path = this.getPathToImage(uuid);

					const image = await fs.promises.readFile(path + uuid + '.' + images[uuid].type || '');
					images[uuid].image = image;
				})());
			}

			await Promise.all(subtasks);
		}

		return { images, totalElements };
	}

	async rmImage(uuid: string): Promise<void> {
		const logPrefix = `${topLogPrefix} rmImage() - `;
		const imgUuid = lUtils.uuidToBuffer(uuid);

		let slug = '';
		let type = '';

		if (!imgUuid) {
			const err = new Error('Invalid uuid');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		// Get slug
		const { rows } = await this.db.query('SELECT * FROM images_images WHERE uuid = ?', imgUuid);
		if (rows.length > 0) {
			slug = rows[0].slug;
			type = rows[0].type;
		}

		// Delete data through queue
		await this.dataWriter.rmImage(uuid);

		// Delete actual file
		const path = this.getPathToImage(uuid);
		const fullPath = `${path + uuid}.${type}`;

		/* istanbul ignore if */
		if (!path) {
			const err = new Error('Could not get path to file with uuid "' + uuid + '"');
			this.log.warn(`${logPrefix} ${err.message}`);

			throw err;
		}

		try {
			await fs.promises.unlink(fullPath);
		} catch (_err) /* istanbul ignore next */ {
			const err = _err as Error;
			this.log.warn(logPrefix + 'Could not unlink file: "' + fullPath + '", err: ' + err.message);
		}

		/* istanbul ignore if */
		if (!slug) return;

		await this.clearCache({ slug: slug, uuid: uuid });
	}

	async saveImage(options: {
		uuid?: string,
		slug?: string,
		file: any, /* formidable file */
		metadata?: Array<{
			name: string,
			data: string,
		}>,
	}): Promise<Image> {
		const logPrefix = `${topLogPrefix} saveImage() -`;

		let tmpFilePath = '';

		if (!options.file) {
			const err = new Error('Missing file object from formidable');
			this.log.warn(`${logPrefix} ${err.message}`);
			this.log.verbose(`${logPrefix} ${err.stack}`);
			throw err;
		}

		if (!options.file.bin && options.file.path) {
			// Read binary data if it is not read already
			options.file.bin = await fs.promises.readFile(options.file.path);
		} else if (options.file.bin && !options.file.path) {
			// Save bin data to temp file if no path was provided
			const imgType = imageType(options.file.bin);
			if (!imgType) {
				const err = new Error('Could not determine image type from data, can not save');
				this.log.warn(`${logPrefix} ${err.message}`);
				throw err;
			}

			tmpFilePath = `${os.tmpdir()}/${uuidLib.v1()}.${imgType.ext}`;

			try {
				await fs.promises.writeFile(tmpFilePath, options.file.bin);
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				this.log.warn(`${logPrefix} Could not write to tmpFilePath: "${tmpFilePath}", err: ${err.message}`);
				throw err;
			}
		} else {
			const err = new Error('Neither binary data or file path was given, can not save');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		let imgType = imageType(options.file.bin);
		const filePath = tmpFilePath || options.file.path;

		// As a first step, check the mime type, since this is already given to us
		if (!imgType ||
			(
				imgType?.mime !== 'image/png' &&
				imgType?.mime !== 'image/jpeg' &&
				imgType?.mime !== 'image/gif'
			)) {
			this.log.info(`${logPrefix} Invalid mime type for image file.`);
			throw new Error('Invalid file format, must be of image type PNG, JPEG or GIF');
		}

		// Resizing gifs not supported by jimp, convert to png instead
		if (imgType?.mime === 'image/gif') {
			this.log.info(`${logPrefix} GIFs not supported. Image will be converted to PNG`);
			tmpFilePath = `${os.tmpdir()}/${uuidLib.v1()}.png`;

			const image = await jimp.read(filePath);
			await image.quality(80).writeAsync(tmpFilePath);

			// Set imageType from file just to be sure
			options.file.bin = await fs.promises.readFile(tmpFilePath);
			imgType = imageType(options.file.bin);

			/* istanbul ignore if */
			if (!imgType) {
				const err = new Error('Failed to get image type after converting to PNG');
				this.log.error(`${logPrefix} ${err.message}`);
				throw err;
			}
		} else {
			// Then actually checks so the file loads in our image lib
			try {
				await jimp.read(filePath);
			} catch (_err) /* istanbul ignore next */ {
				const err = _err as Error;
				this.log.warn(`${logPrefix} Unable to open image file: ${err.message}`);
				throw err;
			}
		}

		// If no slug or uuid was supplied use the filename as base for the slug
		if (!options.uuid && !options.slug) {
			options.slug = options.file.name;
		}

		// If no slug is set by here, it means an id is supplied and the slug
		// should not change in the database, no need to check anything more here
		if (options.slug) {
			options.slug = slugify(options.slug, { save: ['/', '.', '_', '-'] });
			// Remove leading and trailing forward slashes
			options.slug = options.slug.replace('^/+|/+$/g', '');

			// If the image was a gif it has been changed to a png and the slug should reflect this
			if (options.slug.endsWith('.gif') && imgType.ext === 'png') {
				this.log.debug(logPrefix + 'Old slug: "' + options.slug + '"');
				options.slug = options.slug.substring(0, options.slug.length - 3) + 'png';
				this.log.debug(logPrefix + 'New slug: "' + options.slug + '"');
			}

			// Make sure it is not occupied by another image
			let sql = 'SELECT uuid FROM images_images WHERE slug = ?';
			const dbFields = [];
			dbFields.push(options.slug);
			if (options.uuid) {
				sql += ' AND uuid != ?';
				dbFields.push(lUtils.uuidToBuffer(options.uuid));
			}

			const { rows } = await this.db.query(sql, dbFields);
			if (rows.length) {
				const err = new Error(`Slug: "${options.slug}" is used by another image entry, try setting another one manually.`);
				this.log.verbose(`${logPrefix} ${err.message}`);
				throw err;
			}
		}

		// Save database data through queue
		options.uuid = options.uuid || uuidLib.v4();
		await this.dataWriter.saveImage({
			uuid: options.uuid,
			slug: options.slug,
			metadata: options.metadata,
			type: imgType.ext,
		});

		// Save file data
		const path = await this.createImageDirectory(options.uuid);
		await fs.promises.writeFile(`${path + options.uuid}.${imgType.ext}`, options.file.bin);

		// Clear cache for this slug
		const { rows: slugRows } = await this.db.query('SELECT slug FROM images_images WHERE uuid = ?', [lUtils.uuidToBuffer(options.uuid)]);

		/* istanbul ignore if */
		if (slugRows.length === 0) {
			const err = new Error(`Could not find database row of newly saved image uuid: "${options.uuid}"`);
			this.log.error(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.clearCache({ slug: slugRows[0].slug });

		// Remove temporary file
		if (tmpFilePath) {
			await fs.promises.unlink(tmpFilePath);
		}

		// Re-read this entry from the database to be sure to get the right deal!
		const { images } = await this.getImages({ uuids: options.uuid, excludeTotalElements: true });

		return Object.values(images)[0];
	}
}
