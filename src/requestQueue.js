var config = require(`../configs/${process.env.WEBPACK_DLL_ENV}.json`);
var path = require('path');
var queue = {};
var utils = require('./utils');
var request = require('request');
var errors = require('./errors');

var packagers = config.packagerServiceUrls.map(function (packageServiceUrl) {
  return {
    url: packageServiceUrl,
    isAvailable: true,
    lastUsed: Date.now()
  }
});

module.exports = {
  add: function (id, packages, file, res) {
    if (queue[id])  {
      queue[id][file].push(res);
    } else {
      queue[id] = {'dll.js': [], 'manifest.json': [], bundle: null};

      queue[id][file].push(res);

      var requeustQueue = this;
      return this.getBundle(packages)
        .then(function (bundle) {
          requeustQueue.resolveFiles(id, bundle);

          return bundle;
        })
    }
  },
  getBundle (packages) {
    var requestQueue = this;

    return new Promise(function (resolve, reject) {
      var availablePackager = packagers.sort(function (packagerA, packagerB) {
        if (packagerA.lastUsed > packagerB.lastUsed) {
          return 1;
        } else if (packagerB.lastUsed < packagerB.lastUsed) {
          return -1;
        }

        return 0;
      }).reduce(function (currentPackager, packager) {
        if (currentPackager) {
          return currentPackager;
        }

        if (packager.isAvailable) {
          return packager;
        }

        return currentPackager;
      }, null);

      if (!availablePackager) {
        throw new Error(errors.PACKAGER_NOT_AVAILABLE);
      }

      availablePackager.lastUsed = Date.now();

      request({
        url: availablePackager.url + '/' + packages,
        timeout: config.packageServiceTimeout
      }, function (err, response, body) {
        if (response && response.statusCode === 503) {
          availablePackager.isAvailable = false;
          resolve(requestQueue.getBundle(packages));
        } else if (err || (response && response.statusCode !== 200)) {
          console.log('PACKAGER ERROR - ' + (err ? err.message : body));
          if (body === 'INVALID_VERSION') {
            reject(new Error(body));
          } else {
            availablePackager.isAvailable = false;
            setTimeout(function () {
              availablePackager.isAvailable = true;
            }, 10000);
            resolve(requestQueue.getBundle(packages));
          }
        } else {
          availablePackager.isAvailable = true;

          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        }
      })
    })
  },
  has: function (id) {
    return Boolean(queue[id]);
  },
  remove: function (id) {
    delete queue[id];
  },
  resolveFiles (id, bundle) {
    this.resolveManifest(id, bundle.manifest);
    this.resolveDll(id, bundle.dll);
  },
  resolveDll: function (id, content) {
    var requests = queue[id]['dll.js'];

    requests.forEach(utils.sendFile('dll.js', content))

    queue[id]['dll.js'] = [];
  },
  resolveManifest: function (id, content) {
    var requests = queue[id]['manifest.json'];

    requests.forEach(utils.sendFile('manifest.json', content));

    queue[id]['manifest.json'] = [];
  },
  reject: function (id, err) {
    var requests = queue[id]['dll.js'].concat(queue[id]['manifest.json']);

    requests.forEach(function (res) {
      try {
        res.status(500).send(err.message);
      } catch (e) {}
    })

    delete queue[id];
  }
}
