var request = require('request'),
  async = require('async'),
  pg = require('pg');


var ACS = function( koop ){

  var acs = {};
  acs.__proto__ = koop.BaseModel( koop );

  // generates a key used to lookup data in the cache
  acs.genKey = function(params){
    return [params['year'], params['state'], params['for'], params['variable']].join('::');
  };

  var geomDB;
  // figure out if we have a PostGIS based cache
  if ( koop.Cache.db && koop.Cache.db.type && koop.Cache.db.type === 'elasticsearch' ){
    // require koop-pgcache 
    geomDB = require('koop-pgcache').connect(koop.config.db.pg, koop);
  } else {
    geomDB = koop.Cache.db;
  }

  // looks at the cache and checks for data
  // requests it from the API if not found in cache 
  acs.find = function( qtype, params, options, callback ){
    var k = 0;
    var q = async.queue(function (task, cb) {
      geomDB._query(task.query, function(err, result) {
        if (err || !result || !result.rows.length){
          return callback(err, null);
        }
        task.feature.geometry = JSON.parse( result.rows[0].geom );
        cb( task.feature );
      });
    }, 4);

    q.drain = function(){
      // insert data
      koop.Cache.insert( type, key, geojson, 0, function( err, success){
        if ( success ) {
          callback( null, [geojson] );
        }
      });
      
    };

    var type = 'acs', 
      key, 
      headers, 
      url, 
      query, 
      feature, 
      geojson = { type:'FeatureCollection', features:[] };

    if ( qtype == 'state' ){
      key = [params.year, params.state, params.variable].join('-');
    } else if (qtype == 'county'){
      key = [params.year, params.state, params.county, params.variable].join('-');
    } else if ( qtype == 'tract'){
      key = [params.year, params.state, params.county, params.tract, params.variable].join('-');
    }

    // for large datasets ingore koop's large data limit 
    options.bypass_limit = true;
 
    // check the cache for data with this type & key
    koop.Cache.get( type, key, options, function(err, entry ){
      if ( err){
        // if we get an err then get the data and insert it 
        switch ( qtype ){
          case 'county':
            url = 'http://api.census.gov/data/'+params['year']+'/acs5?get='+params['variable']+'&for=county:'+params['county']+'&in=state:'+params['state'];
            break;
          case 'state': 
            url = 'http://api.census.gov/data/'+params['year']+'/acs5?get='+params['variable']+'&for=state:'+params['state'];
            break;
          case 'tract':
            url = 'http://api.census.gov/data/'+params['year']+'/acs5?get='+params['variable']+'&for=tract:'+params['tract']+'&in=state:'+params['state']+'+county:'+params['county']; 
            break;
        }
        url += '&key=b2410e6888e5e1e6038d4e115bd8a453f692e820';

        request.get(url, function(e, res){
          try {
            var json = JSON.parse(res.body);
            json.forEach(function(row,i){
              if (i == 0){
                headers = row;
              } else {
                feature = {type:'Feature', properties:{}};
                row.forEach(function(col,j){
                  feature.properties[headers[j]] = (!isNaN(parseInt(col)) && !( headers[j] == 'county' || headers[j] == 'state' || headers[j] == 'tract')) ? parseInt(col) : col;
                });
                switch ( qtype ){
                  case 'county':
                    query = "select st_asgeojson(geom) as geom from us_counties where countyfp = '"+feature.properties.county+"' AND statefp = '"+feature. properties.state+"'";
                    break;
                  case 'state':
                    query = "select st_asgeojson(geom) as geom from us_states where statefp = '"+feature. properties.state+"'";
                    break;
                  case 'tract':
                    query = "select st_asgeojson(geom) as geom from tracts where tractce = '"+feature.properties.tract+"' AND statefp = '"+feature.properties.state+"' AND countyfp = '"+feature.properties.county+"'";
                    break;
                }
                q.push({query: query, feature: feature}, function(f){
                  geojson.features.push( f );
                });
              }
            });
          
          } catch(e){
            console.log(e);
            callback(res.body, null);
          }
        });
      } else {
        // We have data already, send it back
        callback( null, entry );
      }
    });
    
  }; 

  // drops from the cache
  acs.drop = function( key, options, callback ){
     // drops the item from the cache
    var dir = [ 'acs', key, 0].join(':');
    koop.Cache.remove('acs', key, options, function(err, res){
      koop.files.removeDir( 'files/' + dir, function(err, res){
        koop.files.removeDir( 'tiles/'+ dir, function(err, res){
          koop.files.removeDir( 'thumbs/'+ dir, function(err, res){
            callback(err, true);
          });
        });
      });
    });
  };

  return acs;
}

module.exports = ACS;
