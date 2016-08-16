'use strict';

const	async	= require('async'),
	img	= require('larvitimages'),
	log	= require('winston');

exports.run = function(req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	let	imgId	= res.globalData.urlParsed.query.id;

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	// Save a POSTed form
	if (res.globalData.formFields.save !== undefined) {
		tasks.push(function(cb) {
			const	saveObj	= {};

			if (imgId !== undefined)
				saveObj.id = imgId;

			if (req.formFiles !== undefined && req.formFiles.image !== undefined && req.formFiles.image.size) {
				log.verbose('larvitimages: ./controllers/adminImageEdit.js - Form image found: ' + JSON.stringify(req.formFiles.image));
				saveObj.uploadedFile = req.formFiles.image;
			}

			if (res.globalData.formFields.slug) {
				log.verbose('larvitimages: ./controllers/adminImageEdit.js - Slug set to: "' + res.globalData.formFields.slug + '"');
				saveObj.slug = res.globalData.formFields.slug;
			}

			img.saveImage(saveObj, function(err, image) {
				if (err) {
					cb(err);
					return;
				} else {
					data.global.messages = ['Saved'];
				}

				if ( ! imgId) {
					req.session.data.nextCallData = {'global': {'messages': ['New image uploaded with ID ' + image.id]}};
					res.statusCode = 302;
					res.setHeader('Location', '/adminImageEdit?id=' + image.id);
					imgId = image.id;
				}

				data.global.messages = ['Saved'];

				cb();
			});
		});
	}

	// Delete a image
	if (res.globalData.formFields.delete !== undefined && imgId !== undefined) {
		tasks.push(function(cb) {
			img.rmImage(imgId, function(err) {
				if (err) { cb(err); return; }

				req.session.data.nextCallData = {'global': {'messages': ['Image with ID ' + imgId + ' deleted']}};
				res.statusCode = 302;
				res.setHeader('Location', '/adminImages');
				cb();
			});
		});
	}

	// Load data from database
	else if (imgId !== undefined) {
		tasks.push(function(cb) {
			img.getImages({'ids': imgId}, function(err, images) {
				res.globalData.formFields = images[0];
				cb();
			});
		});
	}

	async.series(tasks, function(err) {
		if (err) {
			data.global.errors = [err.message];
		}

		cb(null, req, res, data);
	});
};
