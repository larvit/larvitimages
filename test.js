'use strict';

async function afunc(str) {
	return new Promise((res, rej) => {
		setTimeout(() => {
			if (Math.random() < 0.5) rej(new Error('asdf'));
			res(str.length);
		}, Math.random() * 1000);
	});
}

async function run() {
	const strs = ['nisse', 'olle', 'pelle'];
	const tasks = [];
	console.log('Run');

	for (const str of strs) {
		console.log(`Adding: ${str}`);
		tasks.push((async function () {
			const value = await afunc(str);
			console.log(`Ran: ${str}, val: ${value}`);
		})());
	}

	const result = await Promise.allSettled(tasks);
	for (const r of result) {
		if (r.reason) console.error('Got an error: ', r.reason);
	}
};

console.log('Running');
run();
