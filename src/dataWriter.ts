import { LogInstance, Utils } from 'larvitutils';

const topLogPrefix = 'larvitimages: dataWriter.js:';

export type DataWriterOptions = {
	db: any,
	log: LogInstance,
	lUtils: Utils,
}

export class DataWriter {
	db: any;
	log: LogInstance;
	lUtils: Utils;

	constructor(options: DataWriterOptions) {
		this.db = options.db;
		this.log = options.log;
		this.lUtils = options.lUtils;
	}

	async rmImage(uuid: string): Promise<void> {
		const logPrefix = `${topLogPrefix} rmImage() - `;
		const uuidBuf = this.lUtils.uuidToBuffer(uuid);

		if (!uuidBuf) {
			const err = new Error(`Invalid uuid supplied: ${uuid}`);
			this.log.error(`${logPrefix + err.message}`);

			throw err;
		}

		// Delete metadata
		await this.db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuidBuf);

		// Delete database entry
		await this.db.query('DELETE FROM images_images WHERE uuid = ?', uuidBuf);
	}

	async saveImage(image: {
		uuid: string,
		slug?: string,
		type?: string,
		metadata?: Array<{ name: string, data: string }>
	}): Promise<void> {
		const logPrefix = `${topLogPrefix} saveImage() - `;
		const uuidBuf = this.lUtils.uuidToBuffer(image.uuid);

		let sql = '';
		let dbFields = [];

		if (!uuidBuf) {
			const err = new Error(`Invalid uuid supplied: ${image.uuid}`);
			this.log.error(`
			${logPrefix + err.message}`);

			throw err;
		}

		// Set image record
		sql = 'INSERT IGNORE INTO images_images (uuid, slug) VALUES(?,?);';
		dbFields = [uuidBuf, image.slug];

		await this.db.query(sql, dbFields);
		this.log.debug(`${logPrefix} New image created with uuid: "${image.uuid}"`);

		// Check if a record was created with our slug and uuid
		// In case the slug was already taken this have not happened and we need to return an error
		const { rows } = await this.db.query('SELECT slug FROM images_images WHERE uuid = ?', uuidBuf);
		if (rows.length === 0) {
			const err = new Error('Slug was already taken (or other unknown error)');
			this.log.info(`${logPrefix + err.message}`);

			throw err;
		}

		// Set slug (We do this in case it changed on an already existing entry)
		sql = 'UPDATE images_images SET slug = ? WHERE uuid = ?;';
		dbFields = [image.slug, uuidBuf];

		await this.db.query(sql, dbFields);

		// Set type if it exists
		if (image.type) {
			const sql = 'UPDATE images_images SET type = ? WHERE uuid = ?;';
			const dbFields = [image.type, uuidBuf];

			await this.db.query(sql, dbFields);
		}

		// Save metadata
		// First delete all existing metadata about this image
		await this.db.query('DELETE FROM images_images_metadata WHERE imageUuid = ?;', uuidBuf);

		// Insert new metadata
		if (Array.isArray(image.metadata) && image.metadata.length) {
			dbFields = [];
			sql = 'INSERT INTO images_images_metadata (imageUuid, name, data) VALUES ';

			for (const meta of image.metadata) {
				sql += '(?,?,?),';
				dbFields.push(uuidBuf);
				dbFields.push(meta.name);
				dbFields.push(meta.data);
			}

			sql = sql.substring(0, sql.length - 1) + ';';
			await this.db.query(sql, dbFields);
		}
	}
}
