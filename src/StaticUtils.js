var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var async = require('async');

module.exports = function(bosco) {

    var AssetHelper = require('./AssetHelper')(bosco);
    var minify = require('./Minify')(bosco).minify;
    var removeDuplicates = require('./Duplicates')(bosco).removeDuplicates;
    var doBuild = require('./ExternalBuild')(bosco).doBuild;
    var getLastCommitForAssets = require('./Git')(bosco).getLastCommitForAssets;
    var html = require('./Html')(bosco);
    var createAssetHtmlFiles = html.createAssetHtmlFiles;
    var attachFormattedRepos = html.attachFormattedRepos;

    function getStaticAssets(options, next) {
        var repoTag = options.repoTag;
        var repoRegex = options.repoRegex;

        async.mapSeries(options.repos, loadService, function(err, services) {

            // Remove any service that doesnt have an assets child
            // or doesn't match repo regex or tag
            services = _.filter(services, function(service) {
                return (!repoRegex || service.name.match(repoRegex)) &&
                    (!repoTag || _.contains(service.tags, repoTag)) &&
                    (service.assets || service.files);
            });



            async.mapSeries(services, function(service, cb) {

                doBuild(service, options, function(err) {
                    if(err) return cb(err);
                    createAssetList(service, options.minify, options.tagFilter, cb);
                });

            }, function(err, assetList) {

                var staticAssets = {};

                assetList.forEach(function(asset) {
                    _.forOwn(asset, function(value, key) {
                        staticAssets[key] = value;
                    });
                });

                // Dedupe
                removeDuplicates(staticAssets, function(err, staticAssets) {
                    // Now go and minify
                    if (options.minify) {
                        getLastCommitForAssets(staticAssets, function(err, staticAssets) {
                            minify(staticAssets, function(err, staticAssets) {
                                createAssetHtmlFiles(staticAssets, next);
                            });
                        });
                    } else {
                      createAssetHtmlFiles(staticAssets, next);
                    }
                });

            });
        });
    }

    function getStaticRepos(options, next) {
        async.mapSeries(options.repos, loadService, function(err, repos){
            attachFormattedRepos(repos, next);
        });
    }

    function createAssetList(boscoRepo, minified, tagFilter, next) {

        var assetKey, staticAssets = {},
            assetBasePath,
            assetHelper = AssetHelper.getAssetHelper(boscoRepo, tagFilter);

        if (boscoRepo.assets) {
            assetBasePath = boscoRepo.assets.basePath || '.';
            _.forEach(_.pick(boscoRepo.assets, ['js', 'css', 'img', 'html', 'swf']), function (assets, type) {
                _.forOwn(assets, function (value, tag) {
                    if (!value) return;
                    _.forEach(value, function (asset) {
                        assetKey = path.join(boscoRepo.name, asset);
                        assetHelper.addAsset(staticAssets, assetKey, asset, tag, type, assetBasePath);
                    });
                });
            });
        }

        if (boscoRepo.files) {
            _.forOwn(boscoRepo.files, function (assetTypes, tag) {
                assetBasePath = assetTypes.basePath || '.';
                _.forEach(_.pick(assetTypes, ['js', 'css', 'img', 'html', 'swf']), function (value, type) {
                    if (!value) return;
                    _.forEach(value, function (asset) {
                        assetKey = path.join(boscoRepo.name, asset);
                        assetHelper.addAsset(staticAssets, assetKey, asset, tag, type, assetBasePath);
                    });
                });
            });
        }

        next(null, staticAssets);

    }

    function loadService(repo, next) {
        var boscoRepo = {}, repoPath = bosco.getRepoPath(repo), boscoConfig,
            boscoRepoConfig = path.join(repoPath, 'bosco-service.json'),
            repoPackageFile = path.join(repoPath, 'package.json');

        boscoRepo.name = repo;
        boscoRepo.path = repoPath;
        boscoRepo.repoPath = repoPath;

        if (bosco.exists(boscoRepoConfig)) {
            boscoConfig = JSON.parse(fs.readFileSync(boscoRepoConfig)) || {};

            boscoRepo = _.merge(boscoRepo, boscoConfig);

            if (boscoRepo.assets && boscoRepo.assets.basePath) {
                boscoRepo.basePath = boscoRepo.assets.basePath;
            }
        }

        if (bosco.exists(repoPackageFile)) {
            // Add the info from the package file to the service and return it
            boscoRepo.info = JSON.parse(fs.readFileSync(repoPackageFile) || {});
        }

        next(null, boscoRepo);
    }

    return {
        getStaticAssets: getStaticAssets,
        getStaticRepos: getStaticRepos
    }

};
