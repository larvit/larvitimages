'use strict';
/* eslint-disable no-unused-vars */

const	adminImages = require(__dirname + '/../controllers/adminImages.js'),
	assert	= require('assert'),
	sinon	= require('sinon'),
	ImgLib	= require(__dirname + '/../index.js'),
	LUtils	= require('larvitutils'),
	lUtils	= new LUtils(),
	log		= new lUtils.Log();

let req,
	res,
	imgLib;

beforeEach(function () {
	req = {};
	res = {};
	
	imgLib = sinon.createStubInstance(ImgLib);
	imgLib.getImages.yieldsAsync(null, {}, 0);

	req.imgLib = imgLib;
	req.log = log;
	res.adminRights = true;
	res.globalData = {
		'urlParsed': {
			'query': {
				'offset': '10',
				'q': 'asdf'
			}
		}
	};
});

describe('Controller adminImages.js', function () {
	it('should call back with error if adminRights is not set', function (done) {
		res.adminRights = undefined;

		adminImages.run(req, res, function (err) {
			assert.ok(err instanceof Error);
			done();
		});
	});

	it('should have pagination in data with correct values', function (done) {
		adminImages.run(req, res, function (err, unused, res, data) {
			assert.ok(data.pagination);
			assert.equal(data.pagination.elementsPerPage, 100);
			assert.equal(data.pagination.urlParsed, res.globalData.urlParsed);
			done();
		});
	});

	it('should pass options to getImages', function (done) {
		adminImages.run(req, res, function (err, req, res, data) {
			sinon.assert.calledWith(imgLib.getImages, {
				'limit': data.pagination.elementsPerPage,
				'offset': 10,
				'q': 'asdf'
			});
			done();
		});
	});

	it('should pass zero as default offset to getImages if not present in url', function (done) {
		res.globalData.urlParsed.query.offset = undefined;
		
		adminImages.run(req, res, function (err, req, res, data) {
			sinon.assert.calledWith(imgLib.getImages, sinon.match.has('offset', 0));
			done();
		});
	});

	it('should pass zero as default offset to getImages if not a number in url', function (done) {
		res.globalData.urlParsed.query.offset = 'l337';
		
		adminImages.run(req, res, function (err, req, res, data) {
			sinon.assert.calledWith(imgLib.getImages, sinon.match.has('offset', 0));
			done();
		});
	});

	it('should pass zero as default offset to getImages if negative number in url', function (done) {
		res.globalData.urlParsed.query.offset = '-13';
		
		adminImages.run(req, res, function (err, req, res, data) {
			sinon.assert.calledWith(imgLib.getImages, sinon.match.has('offset', 0));
			done();
		});
	});

	it('totalElements is set in data based on result from getImages', function (done) {
		imgLib.getImages.yieldsAsync(null, {}, 103);
		
		adminImages.run(req, res, function (err, req, res, data) {
			assert.equal(data.pagination.totalElements, 103);
			done();
		});
	});

	it('images is set in data based on result from getImages', function (done) {
		const images = {'some-uuid': {'bunch': 'of', 'img': 'data'}};
		imgLib.getImages.yieldsAsync(null, images, 103);
		
		adminImages.run(req, res, function (err, req, res, data) {
			assert.equal(data.images, images);
			done();
		});
	});

	it('calls back with error if getImages gives error', function (done) {
		const theError = new Error('an error');
		imgLib.getImages.yieldsAsync(theError);
		
		adminImages.run(req, res, function (err, req, res, data) {
			assert.equal(err, theError);
			assert.equal(req, undefined);
			assert.equal(res, undefined);
			assert.equal(data, undefined);
			done();
		});
	});
});

afterEach(function () {
	sinon.restore();
});