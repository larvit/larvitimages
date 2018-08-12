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

### LarvitBase

To be able to load the images in the browser, add this to larvitbase config:

```javascript
serverConf.customRoutes = [{
	'regex':	'^/uploaded/images/',
	'controllerName':	'serveDbImages'
}];
```

### Paths

```javascript
const	winston	= require('winston'),
	ImgLib	= require('larvitimages'),
	log	= winston.createLogger({'transports': [new winston.transports.Console()]}),
	db	= require('larvitdb'),
	img = new ImgLib({
		'db':	db,

		// Optional configuration
		'storagePath':	process.cwd() + '/larvitimages',	// This is the default
		'cachePath':	require('os').tmpdir() + '/larvitimages_cache',	// This is the default
		'log':	log,	// Will use a basic console.log/error log if not set
		'mode':	'noSync',	// This is the default, other options is "master" and "slave"
		'intercom':	new (require('larvitamintercom'))('loopback interface'),	// This is the default
		'exchangeName':	'larvitimages',	// This is the default, RabbitMQ exchange name for the datawriter
		'amsync_host':	null,	// See larvitamsync for details
		'amsync_minPort':	null,	// See larvitamsync for details
		'amsync_maxPort':	null	// See larvitamsync for details
	});

db.setup({
	'connectionLimit':	10,
	'sockehosttPath':	'127.0.0.1',
	'user':	'foo',
	'password':	'bar',
	'charset':	'utf8mb4_general_ci',
	'supportBigNumbers':	true,
	'database':	'dbname'
});

// OPTIONAL!
// You can set the paths after init, like this:
//img.storagePath	= process.cwd() + '/larvitimages';
//img.cachePath	= require('os').tmpdir() + '/larvitimages_cache';
```

## Usage

### Save image

```javascript
const image = {
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

### Get image by uuid

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

### Get image by slug

```javascript
const options = {
	'slugs':	['Some slug'],
	'includeBinaryData':	true // If false or undefined only image data will be fetched.
};

img.getImages(options, function(err, image) {
	if (err) throw err;
	// Do something with you image
	cb();
});
```
