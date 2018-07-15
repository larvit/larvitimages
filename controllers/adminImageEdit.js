'use strict';

const	logPrefix	= 'larvitimages: ./controllers/adminImageEdit.js - ',
	async	= require('async'),
	img	= require('larvitimages'),
	log	= require('winston');

function formatFormData(formData) {
	if (formData && Array.isArray(formData.metadata)) {
		formData.metadata_names	= [];
		formData.metadata_data	= [];

		for (let i = 0; formData.metadata[i] !== undefined; i ++) {
			formData.metadata_names.push(formData.metadata[i].name);
			formData.metadata_data.push(formData.metadata[i].data);
		}

		delete formData.metadata;
	}
}

exports.run = function (req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	let	imgUuid	= res.globalData.urlParsed.query.uuid;

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) return cb(new Error('Invalid rights'), req, res, {});

	// Save a POSTed form
	if (res.globalData.formFields.save !== undefined) {
		tasks.push(function (cb) {
			const	saveObj	= {};

			if (imgUuid !== undefined) {
				saveObj.uuid = imgUuid;
			}

			if (req.formFiles !== undefined && req.formFiles.image !== undefined && req.formFiles.image.size) {
				log.verbose(logPrefix + 'Form image found: ' + JSON.stringify(req.formFiles.image));
				saveObj.file	= req.formFiles.image;
			}

			if (res.globalData.formFields.slug) {
				log.verbose(logPrefix + 'Slug set to: "' + res.globalData.formFields.slug + '"');
				saveObj.slug	= res.globalData.formFields.slug;
			}

			if (Array.isArray(res.globalData.formFields.metadata_names)) {
				saveObj.metadata	= [];

				for (let i = 0; res.globalData.formFields.metadata_names[i] !== undefined; i ++) {
					const	name	= res.globalData.formFields.metadata_names[i],
						data	= res.globalData.formFields.metadata_data[i];

					if (name !== '') {
						saveObj.metadata.push({
							'name':	name,
							'data':	data
						});
					}
				}
			}

			img.saveImage(saveObj, function (err, image) {
				if (err) return cb(err);

				if ( ! imgUuid) {
					req.session.data.nextCallData	= {'global': {'messages': ['New image uploaded with ID ' + image.uuid]}};
					res.statusCode	= 302;
					imgUuid	= image.uuid;
					res.setHeader('Location', '/adminImageEdit?uuid=' + image.uuid);
				}

				data.global.messages = ['Saved'];

				cb();
			});
		});
	}

	// Delete a image
	if (res.globalData.formFields.delete !== undefined && imgUuid !== undefined) {
		tasks.push(function (cb) {
			img.rmImage(imgUuid, function (err) {
				if (err) return cb(err);

				req.session.data.nextCallData	= {'global': {'messages': ['Image with ID ' + imgUuid + ' deleted']}};
				res.statusCode	= 302;
				res.setHeader('Location', '/adminImages');
				cb();
			});
		});

	// Load data from database
	} else if (imgUuid !== undefined) {
		tasks.push(function (cb) {
			img.getImages({'uuids': imgUuid}, function (err, images) {
				if (err) return cb(err);

				res.globalData.formFields = images[Object.keys(images)[0]];
				formatFormData(res.globalData.formFields);
				cb(err);
			});
		});
	}

	async.series(tasks, function (err) {
		if (err) {
			data.global.errors = [err.message];
		}

		cb(null, req, res, data);
	});
};
