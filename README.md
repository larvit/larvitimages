[![Build Status](https://travis-ci.org/larvit/larvitimages.svg?branch=master)](https://travis-ci.org/larvit/larvitimages) [![Dependencies](https://david-dm.org/larvit/larvitimages.svg)](https://david-dm.org/larvit/larvitimages.svg)

# larvitimages

Image resizing, admin page and database for images meta data.


## Fetch image from browser

The given examples suggests you have an image with the slug "test.jpg" in the database.

To fetch the raw image: http://something.com/uploaded/images/test.jpg

The following will keep aspect ratio:
To rescale to width 200px: http://something.com/uploaded/images/test.jpg?width=200
To rescale to height 200px: http://something.com/uploaded/images/test.jpg?height=200

To rescale regardless of aspect ratio: http://something.com/uploaded/images/test.jpg?width=200&height=200


## Configuration

##### LarvitBase

To be able to load the images in the browser, add this to larvitbase config:
```javascript
serverConf.customRoutes = [{
	'regex':	'^/uploaded/images/',
	'controllerName':	'serveDbImages'
}];
```

#### Paths

Configuring the paths to directories the image will be stored.

```json
{
	"storagePath": "/path/to/storage/",	// Optional, default is process.cwd() + '/larvitimages'
	"cachePath": "/path/to/cache/"	// Optional, default is require('os').tmpdir() + '/larvitimages_cache'
}
```

## Usage

#### Save image

```javascript
const imgLib = require('larvitimages'),
			image = {
				'slug' : 'Some string',
				'file': {
					'bin': imageBuffer
				}
				'metadata': [
					{
						'name': 'deer',
						'data': 'tasty'
					},
					{
						'name': 'frog',
						'data': 'disgusting'
					}
				]
			};

img.saveImage(saveObj, function(err, image) {
	if (err) throw err;
	// Image is saved, to something fun
	cb();
});
```

#### Get image by uuid

```javascript
const options = {
	'uuids':	['f997a1a8-272c-4817-885c-981ad78b9700'],
	'includeBinaryData':	true // If false or undefined only image data will be fetched.
};

img.getImages(options, function(err, image) {
	if (err) throw err;
	// Do something with you image
	cb();
});
```

#### Get image by slug

```javascript
const options = {
	'slugs': ['Some slug'],
	'includeBinaryData':	true // If false or undefined only image data will be fetched.
};

img.getImages(options, function(err, image) {
	if (err) throw err;
	// Do something with you image
	cb();
});
```
