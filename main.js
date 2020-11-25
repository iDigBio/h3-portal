var $ = require("jquery");
var chroma = require("chroma-js");
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import geojson2h3 from 'geojson2h3';
const h3 = require("h3-js");
import geohash from 'ngeohash';
var moment = require('moment');
import * as turf from 'turf'
const classifyPoint = require("robust-point-in-polygon");

//var _apiHost = 'prototype-api.idigbio.org:5003';
//var _apiHost = 'prototype-api.idigbio.org';
var _apiHost = 'localhost:5003';

var n = 90;
var s = -90;
var e = 180;
var w = -180;

var lati = 45;
var lngi = 45;

var lockmap = false;

var selCount = 0;
var viewCount = 0;
var allCount = 0;

var selectedData;
var viewData;
var allData;

const distinct = (value, index, self) => {
    return self.indexOf(value) === index;
}

function myarea(bounds) {
    if (Math.abs(bounds.getNorthWest().lng - bounds.getSouthEast().lng) > 360) {
        return 509968658.925;
    }
    return turf.area(turf.polygon([boundspoly(bounds).coordinates])) / 1000000;
}

function estogj(d) {
    var gj = {
        type: 'FeatureCollection',
        features: [],
        full: false,
        doccount: 0,
        hits: 0,
        coordsearch: true
    };
    d.hits.hits.forEach(function(entry) {
        var e = {
            type: 'Feature',
            id: entry._id,
            geometry: {
                type: 'Point',
                coordinates: [entry._source.geopoint.lon, entry._source.geopoint.lat]
            },
            properties: {}
        };
        gj.features.push(e);
    });
    gj.full = (d.hits.total > d.hits.hits.length);
    gj.doccount = d.hits.hits.length;
    gj.hits = d.hits.total;
    return gj;
}

function stats(pairs) {
    var total = 0;
    var min = pairs[0][0];
    var max = pairs[0][0];
    pairs.forEach(function(pair, index) {
        total += pair[0];
        if (pair[0] < min) min = pair[0];
        if (pair[0] > max) max = pair[0];
    });
    //return [(total / pairs.length), min, max];
    return [0, min, max];
}

function shift(pairs, min, max) {
    pairs.forEach(function(pair, index) {
        if (pair[0] < 0) {
            pair[0] = (180 + pair[0]) + 180;
        }
    });
}

//Assumes normalized lat, lng pairs where lng is the first of each pair
function denormalizeArray(gj) {
    gj.forEach(function(coords, index) {
        coords.geometry.coordinates.forEach(function(pairs, index) {
            if (Math.abs(pairs[0][0]) > 160) {
                var s = stats(pairs);
                if ((s[2] - s[1]) > 180) {
                    shift(pairs);
                }
            }
        });
    });
}

mapboxgl.accessToken = 'pk.eyJ1Ijoid2lsc290YyIsImEiOiJjaXc1NmR6cTUwMHBnMm5yMzhhNzRtMW52In0.ngUOA-6mkUX_6Udko7N0Tw';

var gj = JSON.parse('{ "type":"FeatureCollection","features":[] }');
var h3gj = JSON.parse('{ "type":"FeatureCollection","features":[] }');

var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v9',
    //zoom: 1.75,
    zoom: 0.9381093057612476,
    center: [0, 0]
});

var size = 100;

var pulsingDot = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),

    onAdd: function() {
        var canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        this.context = canvas.getContext('2d');
    },

    render: function() {
        var duration = 1000;
        var t = (performance.now() % duration) / duration;

        var radius = size / 2 * 0.3;
        var outerRadius = size / 2 * 0.7 * t + radius;
        var context = this.context;

        // draw outer circle
        context.clearRect(0, 0, this.width, this.height);
        context.beginPath();
        context.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
        context.fillStyle = 'rgba(150, 150, 255,' + (1 - t) + ')';
        context.fill();

        // draw inner circle
        context.beginPath();
        context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
        context.fillStyle = 'rgba(100, 100, 255, 1)';
        context.strokeStyle = 'white';
        context.lineWidth = 2 + 4 * (1 - t);
        context.fill();
        context.stroke();

        // update this image's data with data from the canvas
        this.data = context.getImageData(0, 0, this.width, this.height).data;

        // keep the map repainting
        map.triggerRepaint();

        // return `true` to let the map know that the image was updated
        return true;
    }
};

map.on('load', function() {
    // Add a geojson point source.
    // Heatmap layers also work with a vector tile source.
    map.addSource('species', {
        "type": "geojson",
        "data": gj
    });

    map.addSource('h3-hexes', {
        "type": "geojson",
        "data": h3gj
    });

    map.addLayer({
        "id": "species-point",
        "type": "circle",
        "source": "species",
        "minzoom": 6,
        "paint": {
            // Size circle radius by species magnitude and zoom level
            "circle-radius": [
                "interpolate", ["linear"],
                ["zoom"],
                7, [
                    "interpolate", ["linear"],
                    ["get", "mag"],
                    1, 1,
                    6, 4
                ],
                16, [
                    "interpolate", ["linear"],
                    ["get", "mag"],
                    1, 5,
                    6, 50
                ]
            ],
            // Color circle by species magnitude
            "circle-color": [
                "interpolate", ["linear"],
                ["get", "mag"],
                1, "rgba(33,102,172,0)",
                2, "rgb(103,169,207)",
                3, "rgb(209,229,240)",
                4, "rgb(253,219,199)",
                5, "rgb(239,138,98)",
                6, "rgb(178,24,43)"
            ],
            "circle-stroke-color": "white",
            "circle-stroke-width": 1,
            // Transition from heatmap to circle layer by zoom level
            "circle-opacity": [
                "interpolate", ["linear"],
                ["zoom"],
                7, 0,
                8, 1
            ]
        }
    }, 'waterway-label');


    map.addLayer({
        "id": "h3-hexes-fill-layer",
        "type": "fill",
        "interactive": false,
        "source": "h3-hexes",
        "paint": {
            'fill-color': {
                property: 'count',
                stops: [
                    [0, '#ffffff'],
                    [1, '#ffffcc'],
                    [2, '#ffeda0'],
                    [3, '#fed976'],
                    [4, '#feb24c'],
                    [5, '#fd8d3c'],
                    [6, '#fc4e2a'],
                    [7, '#e31a1c'],
                    [8, '#bd0026'],
                    [9, '#800026']
                ]
            },
            'fill-outline-color': 'rgba(0,0,0,0)',
            'fill-opacity': 0.5
        }
    }, 'waterway-label');

    map.addImage('pulsing-dot', pulsingDot, {
        pixelRatio: 2
    });

    map.addLayer({
        "id": "points",
        "type": "symbol",
        "source": {
            "type": "geojson",
            "data": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [0, 0]
                    }
                }]
            }
        },
        "layout": {
            "icon-image": "pulsing-dot"
        }
    });

    map.setLayoutProperty('points', 'visibility', 'none');

    var bounds = map.getBounds();
    var data = {
        //precision: 3,
        precision: precisionForView(),
        data: "",
        _nw: bounds.getNorthWest(),
        _se: bounds.getSouthEast()
    };
    data.data = $("#tbSearch").val();
    querygh2(data);
    lastbounds = boundspoly(bounds).coordinates;

});

var features = {};

function present(d) {
    var blah = "";
    if (d == undefined) return;
    for (var f in d.hits) {
        var rec = d.hits[f];
        features[rec._id] = {
            geometry: rec._source.geopoint,
            basisofrecord: rec._source.basisofrecord,
            "class": rec._source["class"],
            datecollected: new Date(rec._source.datecollected),
            family: rec._source.family,
            genus: rec._source.genus,
            kingdom: rec._source.kingdom,
            order: rec._source.order,
            phylum: rec._source.phylum,
            scientificname: (rec._source.scientificname != null ? rec._source.scientificname.split(/[(,]+/)[0].trim() : ''),
            specificepithet: rec._source.specificepithet
        };
        var id = rec._id;
        blah += "<div class='row rec border-bottom' style='cursor: pointer' id='" + id + "'>";
        blah += "<div class='col-3'><span>" + features[id].scientificname + "</span></div><div class='col-7'><span>" + features[id].family + " > " + features[id].order + " > " + features[id]["class"] + " > " + features[id].phylum + " > " + features[id].kingdom + "</span></div>";
        blah += "<div class='col-2'><span>";
        if (rec._source.geopoint !== undefined) {
            blah += "<i class='fa fa-map-marker text-secondary' aria-hidden='true'></i>&nbsp;";
        }
        if (rec._source.hasImage == true) {
            blah += "<i class='fas fa-images text-secondary' aria-hidden='true'></i>&nbsp;";
        }
        /*
        if (rec._source.hasMedia == true) {
            blah += "<i class='fas fa-photo-video text-secondary' aria-hidden='true'></i>&nbsp;";
        }
        */
        blah += "</span></div>";
        blah += "<div class='col-6'><span>" + features[id].basisofrecord + " (" + moment(features[id].datecollected).format('YYYY MMM') + ")</span></div><div class='col-6'>";
        blah += "</div></div>";
    }
    console.log("setting height: ");
    console.log($("#listparent")[0].offsetHeight);
    console.log($("#list")[0].offsetTop);
    document.querySelector("#list").style.maxHeight = $("#listparent")[0].offsetHeight - $("#list")[0].offsetTop + "px";
    $("#list").html(blah).promise().done(function() {
        $("div.rec").mouseenter(function(e) {
            $(this).addClass("highlight-selector");
            if (features[$(this)[0].id].geometry !== undefined) {
                var fc = {
                    "type": "FeatureCollection",
                    "features": [{
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [features[$(this)[0].id].geometry.lon, features[$(this)[0].id].geometry.lat]
                        }
                    }]
                };
                map.getSource('points').setData(fc);
                map.setLayoutProperty('points', 'visibility', 'visible');
            } else {
                map.setLayoutProperty('points', 'visibility', 'none');
            }
        });
        $("div.rec").mouseleave(function(e) {
            //$(".highlight-selector").removeClass("highlight-selector");
            $(this).removeClass("highlight-selector");
            map.setLayoutProperty('points', 'visibility', 'none');
        });

    });
}

function polysuc(d, st, s) {
    selectedData = d.hits;
    present(selectedData);
    $("#selected").text(d.hits.total);
}

function polyfail(a, b, c) {
    complete();
}

// When a click event occurs on a feature in the places layer, open a popup at the
// location of the feature, with description HTML from its properties.
map.on('click', 'h3-hexes-fill-layer', function(e) {
    var coordinates = e.features[0].geometry.coordinates.slice();
    var description = e.features[0].properties.key;

    $("#btnInView").removeClass("btn-success");
    $("#btnSelected").addClass("btn-success");
    $("#btnTotal").removeClass("btn-success");
    // Ensure that if the map is zoomed out such that multiple
    // copies of the feature are visible, the popup appears
    // over the copy being pointed to.
    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
    }
    console.log(description);
    var data = {
        data: $("#tbSearch").val(),
        //_pg: coordinates[0]
        h3i: description
        //precision: precisionForView()
    };

    lockmap = true;
    console.log(coordinates);
    query2('polygon', data, polysuc, polyfail, {
        dt: data
    });
});


// Change the cursor to a pointer when the mouse is over the places layer.
map.on('mouseenter', 'h3-hexes-fill-layer', function() {
    map.getCanvas().style.cursor = 'crosshair';
});

// Change it back to a pointer when it leaves.
map.on('mouseleave', 'h3-hexes-fill-layer', function() {
    map.getCanvas().style.cursor = '';
});

function precisionForView() {
    var bounds = map.getBounds();

    var area = myarea(bounds); //square km

    var numofhexes = 0;
    //var maxzoom = 10;
    //for (var i = 15; i >= 0; i--) {
    for (var i = 0; i < 16; i++) {
        numofhexes = area / areas[i];
        console.log("number of hexes search: " + numofhexes);
        //if (numofhexes < 14285) return i;
        //if (numofhexes < 10001) return i;
        //if (numofhexes < 5883) return i;
        //if (numofhexes > 14284) return i;
        if (numofhexes > 2039) return i;
    }
    return 2;
}

map.on('movestart', function(event) {
    ts_start = Date.now();
    console.log("MOVE START: " + ts_start);
});

var zoom = 2;

var lastbounds;

map.on('moveend', function(event) {
    var bounds = map.getBounds();

    var poly = turf.polygon([boundspoly(bounds).coordinates]);
    var area = myarea(bounds); //square km

    var newzoom = precisionForView();

    var data = {
        //precision: precisionForZoom(newzoom),
        precision: precisionForView(),
        data: $('#tbSearch').val(),
        _nw: bounds.getNorthWest(),
        _se: bounds.getSouthEast()
    };
    viewData = null;
    zoom = newzoom;
    var area = areas[zoom] > 0.5 ? (Math.round(areas[zoom]).toString() + " km<sup>2</sup>") : (Math.round(areas[zoom] * 1000000).toString() + " m<sup>2</sup>");
    $("#lr10").html(area);
    console.log("area is: " + areas[zoom]);

    lastbounds = boundspoly(bounds).coordinates;

    //TODO: if in view mode query view after geohash
    querygh2(data);

});

function boundspoly(b) {

    var nw = [b.getNorthWest().lng, b.getNorthWest().lat];
    var sw = [b.getSouthWest().lng, b.getSouthWest().lat];
    var se = [b.getSouthEast().lng, b.getSouthEast().lat];
    var ne = [b.getNorthEast().lng, b.getNorthEast().lat];

    var poly = {
        type: "Polygon",
        coordinates: [
            nw,
            sw,
            se,
            ne,
            nw
        ]
    };

    return poly;
}

var areas = [4250546.8477, 607220.9782429, 86745.8540347, 12392.2648621, 1770.3235517, 252.9033645, 36.1290521, 5.1612932, 0.7373276, 0.1053325, 0.0150475, 0.0021496, 0.0003071, 0.0000439, 0.0000063, 0.0000009];

var complete_bounds = null;
var global_complete = true;

function query2(_type, _queryParams, _successFunc, _errorFunc, _queryState) {
    working();
    //complete function param?
    $.ajax({
        type: "POST",
        url: 'http://' + _apiHost + '/' + _type,
        dataType: "json",
        data: JSON.stringify(_queryParams),
        contentType: "application/json; charset=utf-8",
        success: function(_data, _textStatus, _jqXHR) {
            if (typeof _data.error == "object" || _data.hits == null) {
                complete();
                alert('error!');
                return;
            }
            _successFunc(_data, _textStatus, _jqXHR, _queryState);
        },
        error: function(_jqXHR, _textStatus, _errorThrown) {
            _errorFunc(_jqXHR, _textStatus, _errorThrown);
        },
        complete: function(_jqXHR, _textStatus) {
            complete();
        }
    });
}

function qsuc(d, st, s, qs) {
    //console.log("DATA: " + d + " Status: " + st + " settings: " + s + " issued: " + ts_query);
    //console.log("START: " + ts_start + ", QUERY: " + ts_query);
    viewData = d.hits;
    viewCount = d.hits.total;
    //present(viewData);
    if (d.hits.hits.length == 50) { // should be == view.total.length
        complete_bounds = qs.qb;
        if (st._nw == undefined) {
            //global_complete = true;
        }
    } else {
        complete_bounds = null;
    }
    if (ts_start > qs.tsq) {
        //console.log("RESPONSE TO OUTDATED REQUEST. IGNORING!!!");
        return;
    }

    gj = d.hits.hits.length < 251 ? estogj(d) : null;


    //var hexs = geojson2h3.featureToH3Set(hexes, 1);
    //h3gj = geojson2h3.h3SetToFeature(hexs);


    // If this was the result of a location free search with an incomplete result set, zoom to a bounding container
    if (!gj.coordsearch && !gj.full) {
        //boundingBox(gj);
    }

    //var testarray = [];
    var testhash = {};
    var testnames = {};
    //var testmedia = {};

    d.hits.hits.forEach(function(e) {
        e._source.scientificname
        if (e._source.scientificname != null) {
            //testarray.push(e.geometry.coordinates);
            testhash[e._id] = e;
            var sn = e._source.scientificname.split(/[(,]+/)[0].trim();
            if (sn in testnames) {
                testnames[sn].push(e);
            } else {
                testnames[sn] = [e];
            }
            //console.log(e.geometry.coordinates);
        }
    });
    present(viewData);
    //console.log(testhash);
    //console.log(testnames);
    if (d.hits.total < 50) map.getSource('species').setData(gj);
    //map.getSource('h3').setData(h3gj);

}

function qfail() {
    complete();
}

function query(data, st) {
    var ts_query = Date.now();
    var query_bounds = map.getBounds();

    query2('view', data, qsuc, qfail, {
        tsq: ts_query,
        qb: query_bounds
    });
}

var colorsg = [];

function colorforval(val, c) {
    var len = c.length;
    for (var i = 0; i < len; i++) {
        if (c[i] >= val) {
            //console.log("color value: " + i / len + " for bucket: " + i);
            //return i / len;
            //if (i == 0) console.log(Math.round(val));

            //console.log("color: " + i + " for val: " + val);

            return i + 1;
        }
    }

    //console.log("color value: " + i / len + " for bucket: " + i);
    //return i / len;
    //console.log("c[i-1] is: " + c[i-1] + " Math.round(val) is: " + Math.round(val));

    //console.log("color: " + (i-1) + " for val: " + val);

    return i + 1;
}

var colors = [];

var gh_inprogress = false;

var gh_next_data;

function qghsuc(d, st, s, qs) {
    //var dt = JSON.parse(d);
    //console.log("rec count: " + dt.hits.total);

    //if (d.aggregations.density.doc_count < 10000) console.log("SWITCH TO NEW HEATMAP!!! *******************************************");

    //This is where recs are populated!
    //query(datag, ts_start);

    if (d.hits.total == 0) {
      allData = null;
      viewData = null;
    }

    viewData = d.hits;
    present(viewData);
    var h3h = {};
    colors = [];
    var max = 0;
    if (d.aggregations != undefined) {
        var bucket;
        for (var p in d.aggregations.density.buckets) {
            //This was used to convert ES geohash aggregations to H3 aggregations. It's lossy and less performant than ES H3 term aggregation
            //max = geo2h3(d, h3h, p, max);
            bucket = d.aggregations.density.buckets[p];
            h3h[bucket.key] = bucket.doc_count;
            if (bucket.doc_count > max) {
                max = bucket.doc_count;
            }
        }
    }
    //console.log(h3h);
    console.log("max: " + max);

    if (max > 1) {
        //TODO: change the 8 below to a lower number where there are fewer key entries
        colors = chroma.limits([1, max], 'l', 8);
    }

    fix(colors);

    var hexgj = geojson2h3.h3SetToFeatureCollection(Object.keys(h3h), hex => ({
        count: (h3h[hex] > 0 ? colorforval(h3h[hex], colors) : 0),
        key: hex
    }));

    //console.log(h3h);
    denormalizeArray(hexgj.features);

    map.getSource('h3-hexes').setData(hexgj);
    //$("#intotal").text(d.hits.total);
    $("#inview").text(d.hits.total);
    if (d.aggregations != undefined) {
        $("#intotal").text(d.aggregations.density.doc_count);
    }

    gh_inprogress = false;

    if (gh_next_data != null) {
        querygh2(gh_next_data);
        //console.log("SET NEXT QUERY TO: ");
        //console.log(gh_next_data);
        //console.log(gh_next_hexes);
        gh_next_data = null;
    }
    if ($("#btnInView").hasClass("btn-success")) {
        //done by each geohash query
        //query(datag, ts_start);
    }
    if ($("#btnSelected").hasClass("btn-success")) {
        present(selectedData);
    }

}

function qghfail() {
    complete();
}

function querygh2(data) {
    //if (lockmap) return;
    viewData = null;
    if (gh_inprogress) {
        console.log("gh in progress, skipping query");
        gh_next_data = data;
        return;
    }
    gh_inprogress = true;
    var ts_query = Date.now();
    var query_bounds = map.getBounds();
    datag = data;
    query2('geohash', data, qghsuc, qghfail, {
        tsq: ts_query,
        qb: query_bounds
    });

    data = null;
    console.log("AJAX set param data NULL");
}

function fix(colorarray) {
    var newcolors = colorarray;
    var len = newcolors.length;
    for (var i = 0; i < len; i++) {
        newcolors[i] = Math.ceil(newcolors[i]);
    }
    colors = newcolors.filter(distinct);
}

var ts_start;

function working() {
    $("#fullpageloading").show();
    $("#maplegend").hide();
}

function complete() {
    gh_inprogress = false;
    $("#lr1").text(colors[0]);
    for (var i = 1; i < 9; i++) {
        //$("#lr" + (i+1)).text((colors[i-1]+1) + " - " + (colors[i]));
        if (i < colors.length) {
            var amt = colors[i];
            $("#cv" + (i + 1)).show();
            $("#lr" + (i + 1)).show().text(amt.toLocaleString());
            //$("#lr" + (i + 1)).text(amt.toLocaleString()).show().prev().show();
        } else {
            $("#cv" + (i + 1)).hide();
            $("#lr" + (i + 1)).hide();
            //$("#lr" + (i + 1)).parent().hide().prev().hide();
        }
    }
    $("#fullpageloading").hide();
    $("#maplegend").fadeIn();
}

var datag = {
    //precision: precisionForZoom(zoom),
    precision: precisionForView(),
    offset: 0.00,
    data: "",
    _nw: map.getBounds().getNorthWest(),
    _se: map.getBounds().getSouthEast()
};

function queryrun(q) {
    lockmap = false;
    global_complete = false;
    ts_start = Date.now();
    var bounds = map.getBounds();
    console.log("proportion offset: " + (0.123 * viewCount));
    datag = {
        //precision: precisionForZoom(zoom),
        precision: precisionForView(),
        offset: 0,
        data: q,
        _nw: bounds.getNorthWest(),
        _se: bounds.getSouthEast()
    };
    if (q != "") {
      location.hash = "#query=" + encodeURI(JSON.stringify(datag));
    }
    $("#btnInView").addClass("btn-success");
    $("#btnSelected").removeClass("btn-success");
    $("#btnTotal").removeClass("btn-success");
    querygh2(datag);
}

function fallbackCopyTextToClipboard(text) {
  var textArea = document.createElement("textarea");
  textArea.value = text;
  
  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    var successful = document.execCommand('copy');
    var msg = successful ? 'successful' : 'unsuccessful';
    console.log('Fallback: Copying text command was ' + msg);
  } catch (err) {
    console.error('Fallback: Oops, unable to copy', err);
  }

  document.body.removeChild(textArea);
}
function copyTextToClipboard(text) {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(function() {
    console.log('Async: Copying to clipboard was successful!');
  }, function(err) {
    console.error('Async: Could not copy text: ', err);
  });
}

$(document).ready(function() {
    $('[data-toggle="popover"]').popover();

    $("#list").scroll(function(e) {
        //var val = Math.round(($(this)[0].scrollTop / $(this)[0].scrollHeight) * allData.hits.length) / allData.total;
        //var val2 = Math.round((($(this)[0].scrollTop + $(this)[0].clientHeight) / $(this)[0].scrollHeight) * allData.hits.length) / allData.total;
        //console.log(Math.round(val * allData.total) + " - " + Math.round(val2 * allData.total));
    });
    $("#tbSearch").change(function(e) {
        queryrun($(this).val());
    });

    $("#btnTotal").click(function(e) {
        console.log("TOTAL");
        $("#btnInView").removeClass("btn-success");
        $("#btnSelected").removeClass("btn-success");
        $("#btnTotal").addClass("btn-success");
        present(allData);
    });

    $("#btnInView").click(function(e) {
        console.log("INVIEW");
        $("#btnInView").addClass("btn-success");
        $("#btnSelected").removeClass("btn-success");
        $("#btnTotal").removeClass("btn-success");
        if (viewData == null) {
            query(datag, ts_start);
        }
        else {
            present(viewData);
        }
    });

    $("#btnSelected").click(function(e) {
        console.log("SELECTED");
        if (selectedData == null) {
            return;
        }
        $("#btnInView").removeClass("btn-success");
        $("#btnSelected").addClass("btn-success");
        $("#btnTotal").removeClass("btn-success");
        present(selectedData);
    });

    $("#basic-addon2").parent().click(function(e) {
        queryrun($("#tbSearch").val());
    });

    $("#btnShare").click(function(e) {
        //TODO: modal dialog
	    //TODO: textarea with location.href
	    //TODO: highlight textarea text
        //document.execCommand("copy");
	    copyTextToClipboard(location.href);
      //$("#taURL").val(location.href);
      $("#taURL").text(location.href);
      $("#taURL").select();

      $('#exampleModalCenter').modal();
      /*
      $('#exampleModalCenter').on('shown.bs.modal', function () {
        $('#myInput').trigger('focus');
      });
      */
    });

    var myquery = "family:elapidae OR (genus:hadronyche AND (specificepithet:formidabilis OR specificepithet:cerberea)) OR family:buthidae OR family:viperidae";
    if (location.hash != "") {
      myquery = JSON.parse(decodeURI(location.hash.split('=')[1]));
    }
    $("#tbSearch").val(myquery.data);
    $("#lr10").html(Math.round(areas[zoom]) + " km<sup>2</sup>");
});
