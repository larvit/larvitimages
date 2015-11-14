# larvitimages

Image resizing, admin page and database for images meta data.

Important! To be able to load the images in the browser, add this to larvitbase config:

```javascript
serverConf.customRoutes = [{
	'regex':          '^/uploaded/images/',
	'controllerName': 'serveDbImages'
}];
```

## Fetch image from browser

The given examples suggests you have an image with the slug "test.jpg" in the database.

To fetch the raw image: http://something.com/uploaded/images/test.jpg

The following will keep aspect ratio:
To rescale to width 200px: http://something.com/uploaded/images/test.jpg?width=200
To rescale to height 200px: http://something.com/uploaded/images/test.jpg?height=200

To rescale regardless of aspect ratio: http://something.com/uploaded/images/test.jpg?width=200&height=200