var _ = require('underscore');
var async = require('async');
var request = require('request');
var mongo = require('mongojs');
var logger = require('./utils/logger');

var beats = {
	// pings URL and measure the response time
	ping: function (options, callback) {
		var url = options.url, started = new Date();

		logger.info('ping: ' + url);

		request({url: options.url}, function (err, resp, body) {
			if (err) {
				return callback({message: 'ping failed', url: url, err: err});
			}

			var report = resp.statusCode !== 200 ?
				{success: false, url: url, statusCode: resp.statusCode} :
				{success: true, url: url, responseTime: new Date() - started, statusCode: resp.statusCode};

			report.success ? logger.success(report) : logger.error(report);

			callback(null, report);
		});
	},

	// requests URL and compare jsons
	json: function (options, callback) {
		var url = options.url, started = new Date(), expected = options.response;

		logger.info('json:' + url);

		request({url: options.url, json: true}, function (err, resp, body) {
			if (err) {
				return callback({message: 'json failed', url: url, err: err});
			}

			var report = resp.statusCode !== 200 ?
				{success: false, url: url, statusCode: resp.statusCode} :
				{success: true, url: url, responseTime: new Date() - started, statusCode: resp.statusCode};

			if (!_.isEqual(body, expected)) {
				report = {success: false, url: url, expected: expected, actual: body};
			}

			report.success ? logger.success(report) : logger.error(report);

			callback(null, report);
		});
	},

	// execute query and measure reponse time
	mongo: function (options, callback) {
		var connection = options.connection, started = new Date();
		var db = mongo.connect(connection, options.collections);
		if (!db) {
			return callback({message: 'failed to connect db', connection: options.connection});
		}

		logger.info('mongo query:' + connection);

		options.query(db, function (err) {
			if (err) {
				return callback({message: 'db failed', connection: connection, err: err});
			}

			db.close();

			var report = {connection: connection, responseTime: new Date() - started};
			logger.success(report);

			callback(null, report);
		});
	}
};

var notifiers = {
	email: function (options, callback) {

	},

	sms: function (options, callback) {

	}
};

function heart(type, options) {
	var beat = beats[type];

	if (!beat) {
		throw new Error('missing beat type for: ' + type);
	}

	return function (callback) {
		beat(options, callback);
	};
}

function notify(type, options) {
	var notif = notifiers[type];

	if (!type) {
		throw new Error('missing notifier type for: ' + type);
	}

	return function (callback) {
		notif(options, callback);
	};
}

function notification(options) {
	var notifications = Object.keys(options).map(function (k) {
		return notify(k, options[k]);
	});

	return function (failures, callback) {
		async.parallel(notifications, callback);
	};
}

function job(type, array, notify) {
	var hearts = array.map(function (e) {
		return heart(type, e);
	});

	return function (callback) {
		async.parallel(hearts, function (err, results) {
			if (err) {
				return callback(err);
			}

			var failures = results.filter(function (r) {
				return !r.success;
			});

			notify(failures, callback);
		});
	};
}

function hearbeat(config) {
	if (!config) {
		throw new Error('config is missing');
	}

	if (!config.monitor) {
		throw new Error('config.monitor section is missing');
	}

	if (!config.notify) {
		throw new Error('config.notify section is missing');
	}

	var notify = notification(config.notify);

	var jobs = Object.keys(config.monitor).map(function (k) {
		return job(k, config.monitor[k], notify);
	});

	return {
		start: function () {
			// heartbeating cycle..
			(function cycle() {
				async.series(jobs, function (err, results) {
					if (err) {
						logger.error(err);
					}

					setTimeout(cycle, config.interval);
				});
			})();
		}
	};
}

module.exports = hearbeat;
