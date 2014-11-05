module.exports.name             = 'test';
// Allowed elements in "postgres" config object:
// user, host, port, geometry_field, srid
module.exports.postgres         = {user:'postgres', password:'vince0931', geometry_field: 'the_geom', srid: 4326};
module.exports.millstone        = {cache_basedir: '/tmp/windshaft-test/millstone'};
module.exports.redis            = {host: '127.0.0.1', 
                                   port: 6379, // 6379 is the default, 6333 is used by grainstore
                                   idleTimeoutMillis: 1,
                                   reapIntervalMillis: 1};
module.exports.mapnik_version   = undefined; // will be looked up at runtime if undefined
module.exports.windshaft_port   = 8083;
module.exports.enable_cors      = true;
