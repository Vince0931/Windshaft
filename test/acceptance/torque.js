// FLUSHALL Redis before starting

var   assert        = require('../support/assert')
    , tests         = module.exports = {}
    , _             = require('underscore')
    , querystring   = require('querystring')
    , fs            = require('fs')
    , redis         = require('redis')
    , th            = require('../support/test_helper')
    , Step          = require('step')
    , mapnik        = require('mapnik')
    , Windshaft     = require('../../lib/windshaft')
    , ServerOptions = require('../support/server_options')
    , http          = require('http');

suite('torque', function() {

    ////////////////////////////////////////////////////////////////////
    //
    // SETUP
    //
    ////////////////////////////////////////////////////////////////////

    var server = new Windshaft.Server(ServerOptions);
    server.setMaxListeners(0);
    var redis_client = redis.createClient(ServerOptions.redis.port);

    checkCORSHeaders = function(res) {
      var h = res.headers['access-control-allow-headers'];
      assert.ok(h);
      assert.equal(h, 'X-Requested-With, X-Prototype-Version, X-CSRF-Token');
      var h = res.headers['access-control-allow-origin'];
      assert.ok(h);
      assert.equal(h, '*');
    };

    suiteSetup(function(done) {

      // Check that we start with an empty redis db 
      redis_client.keys("*", function(err, matches) {
          if ( err ) { done(err); return; }
          assert.equal(matches.length, 0, "redis keys present at setup time:\n" + matches.join("\n"));
          done();
      });

    });

    test("missing required property from torque layer", function(done) {

      var layergroup =  {
        version: '1.1.0',
        layers: [
           { type: 'torque', options: {
               sql: 'select cartodb_id, the_geom from test_table',
               geom_column: 'the_geom',
               srid: 4326,
               cartocss: 'Map { marker-fill:blue; }'
             } }
        ]
      };

      Step(
        function do_post1()
        {
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(layergroup)
          }, {}, function(res) { next(null, res); });
        },
        function checkResponse(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ': ' + res.body);
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors, parsed);
          var error = parsed.errors[0];
          assert.equal(error,
            "Missing required property '-torque-frame-count' in torque layer CartoCSS");
          return null;
        },
        function do_post2(err)
        {
          if ( err ) throw err;
          var next = this;
          var css = 'Map { -torque-frame-count: 2; }';
          layergroup.layers[0].options.cartocss = css;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(layergroup)
          }, {}, function(res) { next(null, res); });
        },
        function checkResponse2(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ': ' + res.body);
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors, parsed);
          var error = parsed.errors[0];
          assert.equal(error,
            "Missing required property '-torque-resolution' in torque layer CartoCSS");
          return null;
        },
        function do_post3(err)
        {
          if ( err ) throw err;
          var next = this;
          var css = 'Map { -torque-frame-count: 2; -torque-resolution: 3; }'
          layergroup.layers[0].options.cartocss = css;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(layergroup)
          }, {}, function(res) { next(null, res); });
        },
        function checkResponse3(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ': ' + res.body);
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors, parsed);
          var error = parsed.errors[0];
          assert.equal(error,
            "Missing required property '-torque-aggregation-function' in torque layer CartoCSS");
          return null;
        },
        function finish(err) {
          done(err);
        }
      );
    });

    // See http://github.com/CartoDB/Windshaft/issues/150
    test.skip("unquoted property in torque layer", function(done) {

      var layergroup =  {
        version: '1.1.0',
        layers: [
           { type: 'torque', options: {
               sql: 'select updated_at as d, cartodb_id as id, the_geom from test_table',
               geom_column: 'the_geom',
               srid: 4326,
               cartocss: 'Map { -torque-frame-count:2; -torque-resolution:3; -torque-time-attribute:"d"; -torque-aggregation-function:count(id); }',
             } }
        ]
      };
      Step(
        function do_post1()
        {
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(layergroup)
          }, {}, function(res) { next(null, res); });
        },
        function checkResponse(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ': ' + res.body);
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors, parsed);
          var error = parsed.errors[0];
          assert.equal(error, "Something meaningful here");
          return null;
        },
        function finish(err) {
          done(err);
        }
      );
    });

    test("can render tile for valid mapconfig", function(done) {

      var mapconfig =  {
        version: '1.1.0',
        layers: [
           { type: 'torque', options: {
               sql: "select 1 as id, '1970-01-02'::date as d, 'POINT(0 0)'::geometry as the_geom UNION select 2, '1970-01-01'::date, 'POINT(1 1)'::geometry",
               geom_column: 'the_geom',
               cartocss: 'Map { -torque-frame-count:2; -torque-resolution:3; -torque-time-attribute:d; -torque-aggregation-function:\'count(id)\'; }',
               cartocss_version: '2.0.1'
             } }
        ]
      };

      var expected_token; 
      Step(
        function do_post()
        {
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(mapconfig)
          }, {}, function(res, err) { next(err, res); });
        },
        function checkPost(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 200, res.statusCode + ': ' + res.body);
          // CORS headers should be sent with response
          // from layergroup creation via POST
          checkCORSHeaders(res);
          var parsedBody = JSON.parse(res.body);
          if ( expected_token ) assert.deepEqual(parsedBody, {layergroupid: expected_token, layercount: 2});
          else expected_token = parsedBody.layergroupid;
          var meta = parsedBody.metadata;
          assert.ok(!_.isUndefined(meta),
            'No metadata in torque MapConfig creation response: ' + res.body);
          var tm = meta.torque;
          assert.ok(tm,
            'No "torque" in metadata:' + JSON.stringify(meta));
          var tm0 = tm[0];
          assert.ok(tm0,
            'No layer 0 in "torque" in metadata:' + JSON.stringify(tm));
          assert.deepEqual(tm0, {"start":0,"end":86400000,"data_steps":2,"column_type":"date"});
          return null;
        },
        function do_get_tile(err)
        {
          if ( err ) throw err;
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup/' + expected_token + '/0/0/0.png',
              method: 'GET',
              encoding: 'binary'
          }, {}, function(res, err) { next(err, res); });
        },
        function check_mapnik_error_1(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ( res.statusCode != 200 ? (': ' + res.body) : '' ));
          var parsed = JSON.parse(res.body);
          assert.equal(parsed.error, "No 'mapnik' layers in MapConfig");
          return null;
        },
        function do_get_grid0(err)
        {
          if ( err ) throw err;
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup/' + expected_token
                 + '/0/0/0/0.grid.json',
              method: 'GET'
          }, {}, function(res, err) { next(err, res); });
        },
        function check_mapnik_error_2(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 400, res.statusCode + ( res.statusCode != 200 ? (': ' + res.body) : '' ));
          var parsed = JSON.parse(res.body);
          assert.equal(parsed.error, "No 'mapnik' layers in MapConfig");
          return null;
        },
        function do_get_torque0(err)
        {
          if ( err ) throw err;
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup/' + expected_token
                 + '/0/0/0/0.json.torque',
              method: 'GET'
          }, {}, function(res, err) { next(err, res); });
        },
        function check_torque0_response(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 200, res.body);
          assert.equal(res.headers['content-type'], "application/json; charset=utf-8");
          var tile_content = [{"x__uint8":43,"y__uint8":43,"vals__uint8":[1,1],"dates__uint16":[0,2]}];
          var parsed = JSON.parse(res.body);
          assert.deepEqual(tile_content, parsed);
          return null;
        },
        function do_get_torque0_1(err)
        {
          if ( err ) throw err;
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup/' + expected_token
                 + '/0/0/0/0.torque.json',
              method: 'GET'
          }, {}, function(res, err) { next(err, res); });
        },
        function check_torque0_response_1(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 200, res.body);
          assert.equal(res.headers['content-type'], "application/json; charset=utf-8");
          var tile_content = [{"x__uint8":43,"y__uint8":43,"vals__uint8":[1,1],"dates__uint16":[0,2]}];
          var parsed = JSON.parse(res.body);
          assert.deepEqual(tile_content, parsed);
          return null;
        },
        function finish(err) {
          var errors = [];
          if ( err ) errors.push(''+err);
          redis_client.exists("map_cfg|" +  expected_token, function(err, exists) {
              if ( err ) errors.push(err.message);
              //assert.ok(exists, "Missing expected token " + expected_token + " from redis");
              redis_client.del("map_cfg|" +  expected_token, function(err) {
                if ( err ) errors.push(err.message);
                if ( errors.length ) done(new Error(errors));
                else done(null);
              });
          });
        }
      );
    });

    // Test that you cannot write to the database from a torque tile request
    //
    // Test for http://github.com/CartoDB/Windshaft/issues/130
    //
    test("database access is read-only", function(done) {
      var mapconfig =  {
        version: '1.1.0',
        layers: [
           { type: 'torque', options: {
               sql: "select 'SRID=3857;POINT(0 0)'::geometry as g, now() as d,* from test_table_inserter(st_setsrid(st_point(0,0),4326),'write')",
               geom_column: 'g',
               cartocss: 'Map { -torque-frame-count:2; -torque-resolution:3; -torque-time-attribute:d; -torque-aggregation-function:\'count(*)\'; }'
               , cartocss_version: '2.0.1'
             } }
        ]
      };
      Step(
        function do_post()
        {
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(mapconfig)
          }, {}, function(res, err) { next(err, res); });
        },
        function checkPost(err, res) {
          if ( err ) throw err;
          // TODO: should be 403 Forbidden
          assert.equal(res.statusCode, 400, res.statusCode + ': ' + (res.statusCode==200?'...':res.body));
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors);
          assert.equal(parsed.errors.length, 1);
          var msg = parsed.errors[0];
          assert.equal(msg, "TorqueRenderer: cannot execute INSERT in a read-only transaction");
          return null;
        },
        function finish(err) {
          done(err)
        }
      );

    });

    // See http://github.com/CartoDB/Windshaft/issues/164
    test("gives a 500 on database connection refused", function(done) {

      var mapconfig =  {
        version: '1.1.0',
        layers: [
           { type: 'torque', options: {
               sql: "select 1 as id, '1970-01-03'::date as d, 'POINT(0 0)'::geometry as the_geom UNION select 2, '1970-01-01'::date, 'POINT(1 1)'::geometry",
               geom_column: 'the_geom',
               cartocss: 'Map { -torque-frame-count:2; -torque-resolution:3; -torque-time-attribute:d; -torque-aggregation-function:\'count(id)\'; }',
               cartocss_version: '2.0.1'
             } }
        ]
      };
      var expected_token; 
      Step(
        function do_post()
        {
          var next = this;
          assert.response(server, {
              url: '/database/windshaft_test/layergroup?dbport=1234567',
              method: 'POST',
              headers: {'Content-Type': 'application/json' },
              data: JSON.stringify(mapconfig)
          }, {}, function(res, err) { next(err, res); });
        },
        function checkPost(err, res) {
          if ( err ) throw err;
          assert.equal(res.statusCode, 500, res.statusCode + ': ' + res.body);
          var parsed = JSON.parse(res.body);
          assert.ok(parsed.errors, parsed);
          var error = parsed.errors[0];
          assert.equal(error, "TorqueRenderer: cannot connect to the database");
          return null;
        },
        function finish(err) {
          done(err);
        }
      );
    });

    ////////////////////////////////////////////////////////////////////
    //
    // TEARDOWN
    //
    ////////////////////////////////////////////////////////////////////

    suiteTeardown(function(done) {

      // Check that we left the redis db empty
      redis_client.keys("*", function(err, matches) {
          try {
            assert.equal(matches.length, 0, "Left over redis keys:\n" + matches.join("\n"));
          } catch (err2) {
            if ( err ) err.message += '\n' + err2.message;
            else err = err2;
          }
          redis_client.flushall(function() {
            done(err);
          });
      });

    });

});

