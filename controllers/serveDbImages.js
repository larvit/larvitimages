'use strict';

var mime = require('mime-types'),
    lwip = require('lwip'),
    img  = require('larvitimages'),
    url  = require('url');

exports.run = function(req, res, cb) {
	var request = url.parse(req.url, true),
	    slug    = request.pathname.substring(17); // /uploaded/images/

	function serverError() {
		res.writeHead(500, {'Content-Type': 'text/plain' });
		res.end('Something is funky with this image, the server got sad. :(');
	}

	img.getImages({'slugs': slug, 'includeBinaryData': true}, function(err, images) {
		var imgRatio,
		    imgType,
		    imgMime;

		if (err) {
			cb(err);
			return;
		}

		if (images.length === 0) {
			res.writeHead(404, {'Content-Type': 'text/plain' });
			res.end('File not found');
			return;
		}

		imgMime = mime.lookup(slug) || 'application/octet-stream';
		if (imgMime === 'image/png')
			imgType = 'png';
		else if (imgMime === 'image/jpeg')
			imgType = 'jpg';
		else if (imgMime === 'image/gif')
			imgType = 'gif';
		else
			imgType = false;

		if (imgType && (request.query.width || request.query.height)) {
			lwip.open(images[0].image, imgType, function(err, lwipImage) {
				var imgWidth,
				    imgHeight;

				if (err) {
					serverError();
					return;
				}

				imgWidth  = lwipImage.width();
				imgHeight = lwipImage.height();
				imgRatio  = imgWidth / imgHeight;

				// Set the missing height or width if only one is given
				if (request.query.width && ! request.query.height)
					request.query.height = Math.round(request.query.width / imgRatio);

				if (request.query.height && ! request.query.width)
					request.query.width = Math.round(request.query.height * imgRatio);

				lwipImage.batch()
					.resize(parseInt(request.query.width), parseInt(request.query.height))
					.toBuffer(imgType, {}, function(err, imgBuf) {
						if (err) {
							serverError();
							return;
						}

						res.writeHead(200, {'Content-Type': imgMime});
						res.end(imgBuf, 'binary');
					});
			});
		} else {
			res.writeHead(200, {'Content-Type': imgMime});
			res.end(images[0].image, 'binary');
		}
	});
};