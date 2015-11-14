# larvitimages

Image resizing, admin page and database for images meta data.

Important! To be able to load the images in the browser, add this to larvitbase config:

```javascript
serverConf.customRoutes = [{
	'regex':          '^/uploaded/images/',
	'controllerName': 'serveDbImages'
}];
```