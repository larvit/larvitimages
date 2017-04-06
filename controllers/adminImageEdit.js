'use strict';

const	logPrefix	= 'larvitimages: ./controllers/adminImageEdit.js - ',
	async	= require('async'),
	img	= require('larvitimages'),
	log	= require('winston');

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
	}

	// Load data from database
	else if (imgUuid !== undefined) {
		tasks.push(function (cb) {
			img.getImages({'uuids': imgUuid}, function (err, images) {
				if (err) return cb(err);

				res.globalData.formFields = images[Object.keys(images)[0]];
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
