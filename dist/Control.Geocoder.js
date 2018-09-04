/* @preserve
 * Leaflet Control Geocoder 1.6.0
 * https://github.com/perliedman/leaflet-control-geocoder
 *
 * Copyright (c) 2012 sa3m (https://github.com/sa3m)
 * Copyright (c) 2018 Per Liedman
 * All rights reserved.
 */

this.L = this.L || {};
this.L.Control = this.L.Control || {};
this.L.Control.Geocoder = (function (L) {
  'use strict';

  L = L && L.hasOwnProperty('default') ? L['default'] : L;

  // Adapted from handlebars.js
  // https://github.com/wycats/handlebars.js/
  var badChars = /[&<>"'`]/g;
  var possible = /[&<>"'`]/;
  var escape = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };

  function escapeChar(chr) {
    return escape[chr];
  }

  function htmlEscape(string) {
    if (string == null) {
      return '';
    } else if (!string) {
      return string + '';
    }

    // Force a string conversion as this will be done by the append regardless and
    // the regex test will do this transparently behind the scenes, causing issues if
    // an object's to string has escaped characters in it.
    string = '' + string;

    if (!possible.test(string)) {
      return string;
    }
    return string.replace(badChars, escapeChar);
  }

  function getJSON(url, params, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() {
      if (xmlHttp.readyState !== 4) {
        return;
      }
      if (xmlHttp.status !== 200 && xmlHttp.status !== 304) {
        callback('');
        return;
      }
      callback(JSON.parse(xmlHttp.response));
    };
    xmlHttp.open('GET', url + getParamString(params), true);
    xmlHttp.setRequestHeader('Accept', 'application/json');
    xmlHttp.send(null);
  }

  function template(str, data) {
    return str.replace(/\{ *([\w_]+) *\}/g, function(str, key) {
      var value = data[key];
      if (value === undefined) {
        value = '';
      } else if (typeof value === 'function') {
        value = value(data);
      }
      return htmlEscape(value);
    });
  }

  function getParamString(obj, existingUrl, uppercase) {
    var params = [];
    for (var i in obj) {
      var key = encodeURIComponent(uppercase ? i.toUpperCase() : i);
      var value = obj[i];
      if (!L.Util.isArray(value)) {
        params.push(key + '=' + encodeURIComponent(value));
      } else {
        for (var j = 0; j < value.length; j++) {
          params.push(key + '=' + encodeURIComponent(value[j]));
        }
      }
    }
    return (!existingUrl || existingUrl.indexOf('?') === -1 ? '?' : '&') + params.join('&');
  }

  var Nominatim = {
    class: L.Class.extend({
      options: {
        serviceUrl: 'https://nominatim.openstreetmap.org/',
        geocodingQueryParams: {},
        reverseQueryParams: {},
        htmlTemplate: function(r) {
          var a = r.address,
            parts = [];
          if (a.road || a.building) {
            parts.push('{building} {road} {house_number}');
          }

          if (a.city || a.town || a.village || a.hamlet) {
            parts.push(
              '<span class="' +
                (parts.length > 0 ? 'leaflet-control-geocoder-address-detail' : '') +
                '">{postcode} {city} {town} {village} {hamlet}</span>'
            );
          }

          if (a.state || a.country) {
            parts.push(
              '<span class="' +
                (parts.length > 0 ? 'leaflet-control-geocoder-address-context' : '') +
                '">{state} {country}</span>'
            );
          }

          return template(parts.join('<br/>'), a, true);
        }
      },

      initialize: function(options) {
        L.Util.setOptions(this, options);
      },

      geocode: function(query, cb, context) {
        getJSON(
          this.options.serviceUrl + 'search',
          L.extend(
            {
              q: query,
              limit: 5,
              format: 'json',
              addressdetails: 1
            },
            this.options.geocodingQueryParams
          ),
          L.bind(function(data) {
            var results = [];
            for (var i = data.length - 1; i >= 0; i--) {
              var bbox = data[i].boundingbox;
              for (var j = 0; j < 4; j++) bbox[j] = parseFloat(bbox[j]);
              results[i] = {
                icon: data[i].icon,
                name: data[i].display_name,
                html: this.options.htmlTemplate ? this.options.htmlTemplate(data[i]) : undefined,
                bbox: L.latLngBounds([bbox[0], bbox[2]], [bbox[1], bbox[3]]),
                center: L.latLng(data[i].lat, data[i].lon),
                properties: data[i]
              };
            }
            cb.call(context, results);
          }, this)
        );
      },

      reverse: function(location, scale, cb, context) {
        getJSON(
          this.options.serviceUrl + 'reverse',
          L.extend(
            {
              lat: location.lat,
              lon: location.lng,
              zoom: Math.round(Math.log(scale / 256) / Math.log(2)),
              addressdetails: 1,
              format: 'json'
            },
            this.options.reverseQueryParams
          ),
          L.bind(function(data) {
            var result = [],
              loc;

            if (data && data.lat && data.lon) {
              loc = L.latLng(data.lat, data.lon);
              result.push({
                name: data.display_name,
                html: this.options.htmlTemplate ? this.options.htmlTemplate(data) : undefined,
                center: loc,
                bounds: L.latLngBounds(loc, loc),
                properties: data
              });
            }

            cb.call(context, result);
          }, this)
        );
      }
    }),

    factory: function(options) {
      return new L.Control.Geocoder.Nominatim(options);
    }
  };

  var Control = {
    class: L.Control.extend({
      options: {
        showResultIcons: false,
        collapsed: true,
        expand: 'touch', // options: touch, click, anythingelse
        position: 'topright',
        placeholder: 'Search...',
        errorMessage: 'Nothing found.',
        queryMinLength: 1,
        suggestMinLength: 3,
        suggestTimeout: 250,
        defaultMarkGeocode: true
      },

      includes: L.Evented.prototype || L.Mixin.Events,

      initialize: function(options) {
        L.Util.setOptions(this, options);
        if (!this.options.geocoder) {
          this.options.geocoder = new Nominatim.class();
        }

        this._requestCount = 0;
      },

      onAdd: function(map) {
        var className = 'leaflet-control-geocoder',
          container = L.DomUtil.create('div', className + ' leaflet-bar'),
          icon = L.DomUtil.create('button', className + '-icon', container),
          form = (this._form = L.DomUtil.create('div', className + '-form', container)),
          input;

        this._map = map;
        this._container = container;

        icon.innerHTML = '&nbsp;';
        icon.type = 'button';

        input = this._input = L.DomUtil.create('input', '', form);
        input.type = 'text';
        input.placeholder = this.options.placeholder;
        L.DomEvent.disableClickPropagation(input);

        this._errorElement = L.DomUtil.create('div', className + '-form-no-error', container);
        this._errorElement.innerHTML = this.options.errorMessage;

        this._alts = L.DomUtil.create(
          'ul',
          className + '-alternatives leaflet-control-geocoder-alternatives-minimized',
          container
        );
        L.DomEvent.disableClickPropagation(this._alts);

        L.DomEvent.addListener(input, 'keydown', this._keydown, this);
        if (this.options.geocoder.suggest) {
          L.DomEvent.addListener(input, 'input', this._change, this);
        }
        L.DomEvent.addListener(
          input,
          'blur',
          function() {
            if (this.options.collapsed && !this._preventBlurCollapse) {
              this._collapse();
            }
            this._preventBlurCollapse = false;
          },
          this
        );

        if (this.options.collapsed) {
          if (this.options.expand === 'click') {
            L.DomEvent.addListener(
              container,
              'click',
              function(e) {
                if (e.button === 0 && e.detail !== 2) {
                  this._toggle();
                }
              },
              this
            );
          } else if (L.Browser.touch && this.options.expand === 'touch') {
            L.DomEvent.addListener(
              container,
              'touchstart mousedown',
              function(e) {
                this._toggle();
                e.preventDefault(); // mobile: clicking focuses the icon, so UI expands and immediately collapses
                e.stopPropagation();
              },
              this
            );
          } else {
            L.DomEvent.addListener(container, 'mouseover', this._expand, this);
            L.DomEvent.addListener(container, 'mouseout', this._collapse, this);
            this._map.on('movestart', this._collapse, this);
          }
        } else {
          this._expand();
          if (L.Browser.touch) {
            L.DomEvent.addListener(
              container,
              'touchstart',
              function() {
                this._geocode();
              },
              this
            );
          } else {
            L.DomEvent.addListener(
              container,
              'click',
              function() {
                this._geocode();
              },
              this
            );
          }
        }

        if (this.options.defaultMarkGeocode) {
          this.on('markgeocode', this.markGeocode, this);
        }

        this.on(
          'startgeocode',
          function() {
            L.DomUtil.addClass(this._container, 'leaflet-control-geocoder-throbber');
          },
          this
        );
        this.on(
          'finishgeocode',
          function() {
            L.DomUtil.removeClass(this._container, 'leaflet-control-geocoder-throbber');
          },
          this
        );

        L.DomEvent.disableClickPropagation(container);

        return container;
      },

      _geocodeResult: function(results, suggest) {
        if (!suggest && results.length === 1) {
          this._geocodeResultSelected(results[0]);
        } else if (results.length > 0) {
          this._alts.innerHTML = '';
          this._results = results;
          L.DomUtil.removeClass(this._alts, 'leaflet-control-geocoder-alternatives-minimized');
          for (var i = 0; i < results.length; i++) {
            this._alts.appendChild(this._createAlt(results[i], i));
          }
        } else {
          L.DomUtil.addClass(this._errorElement, 'leaflet-control-geocoder-error');
        }
      },

      markGeocode: function(result) {
        result = result.geocode || result;

        this._map.fitBounds(result.bbox);

        if (this._geocodeMarker) {
          this._map.removeLayer(this._geocodeMarker);
        }

        this._geocodeMarker = new L.Marker(result.center)
          .bindPopup(result.html || result.name)
          .addTo(this._map)
          .openPopup();

        return this;
      },

      _geocode: function(suggest) {
        var value = this._input.value;
        if (!suggest && value.length < this.options.queryMinLength) {
          return;
        }

        var requestCount = ++this._requestCount,
          mode = suggest ? 'suggest' : 'geocode',
          eventData = { input: value };

        this._lastGeocode = value;
        if (!suggest) {
          this._clearResults();
        }

        this.fire('start' + mode, eventData);
        this.options.geocoder[mode](
          value,
          function(results) {
            if (requestCount === this._requestCount) {
              eventData.results = results;
              this.fire('finish' + mode, eventData);
              this._geocodeResult(results, suggest);
            }
          },
          this
        );
      },

      _geocodeResultSelected: function(result) {
        this.fire('markgeocode', { geocode: result });
      },

      _toggle: function() {
        if (L.DomUtil.hasClass(this._container, 'leaflet-control-geocoder-expanded')) {
          this._collapse();
        } else {
          this._expand();
        }
      },

      _expand: function() {
        L.DomUtil.addClass(this._container, 'leaflet-control-geocoder-expanded');
        this._input.select();
        this.fire('expand');
      },

      _collapse: function() {
        L.DomUtil.removeClass(this._container, 'leaflet-control-geocoder-expanded');
        L.DomUtil.addClass(this._alts, 'leaflet-control-geocoder-alternatives-minimized');
        L.DomUtil.removeClass(this._errorElement, 'leaflet-control-geocoder-error');
        this._input.blur(); // mobile: keyboard shouldn't stay expanded
        this.fire('collapse');
      },

      _clearResults: function() {
        L.DomUtil.addClass(this._alts, 'leaflet-control-geocoder-alternatives-minimized');
        this._selection = null;
        L.DomUtil.removeClass(this._errorElement, 'leaflet-control-geocoder-error');
      },

      _createAlt: function(result, index) {
        var li = L.DomUtil.create('li', ''),
          a = L.DomUtil.create('a', '', li),
          icon = this.options.showResultIcons && result.icon ? L.DomUtil.create('img', '', a) : null,
          text = result.html ? undefined : document.createTextNode(result.name),
          mouseDownHandler = function mouseDownHandler(e) {
            // In some browsers, a click will fire on the map if the control is
            // collapsed directly after mousedown. To work around this, we
            // wait until the click is completed, and _then_ collapse the
            // control. Messy, but this is the workaround I could come up with
            // for #142.
            this._preventBlurCollapse = true;
            L.DomEvent.stop(e);
            this._geocodeResultSelected(result);
            L.DomEvent.on(
              li,
              'click',
              function() {
                if (this.options.collapsed) {
                  this._collapse();
                } else {
                  this._clearResults();
                }
              },
              this
            );
          };

        if (icon) {
          icon.src = result.icon;
        }

        li.setAttribute('data-result-index', index);

        if (result.html) {
          a.innerHTML = a.innerHTML + result.html;
        } else {
          a.appendChild(text);
        }

        // Use mousedown and not click, since click will fire _after_ blur,
        // causing the control to have collapsed and removed the items
        // before the click can fire.
        L.DomEvent.addListener(li, 'mousedown touchstart', mouseDownHandler, this);

        return li;
      },

      _keydown: function(e) {
        var _this = this,
          select = function select(dir) {
            if (_this._selection) {
              L.DomUtil.removeClass(_this._selection, 'leaflet-control-geocoder-selected');
              _this._selection = _this._selection[dir > 0 ? 'nextSibling' : 'previousSibling'];
            }
            if (!_this._selection) {
              _this._selection = _this._alts[dir > 0 ? 'firstChild' : 'lastChild'];
            }

            if (_this._selection) {
              L.DomUtil.addClass(_this._selection, 'leaflet-control-geocoder-selected');
            }
          };

        switch (e.keyCode) {
          // Escape
          case 27:
            if (this.options.collapsed) {
              this._collapse();
            }
            break;
          // Up
          case 38:
            select(-1);
            break;
          // Up
          case 40:
            select(1);
            break;
          // Enter
          case 13:
            if (this._selection) {
              var index = parseInt(this._selection.getAttribute('data-result-index'), 10);
              this._geocodeResultSelected(this._results[index]);
              this._clearResults();
            } else {
              this._geocode();
            }
            break;
          default:
            return;
        }

        L.DomEvent.preventDefault(e);
      },
      _change: function() {
        var v = this._input.value;
        if (v !== this._lastGeocode) {
          clearTimeout(this._suggestTimeout);
          if (v.length >= this.options.suggestMinLength) {
            this._suggestTimeout = setTimeout(
              L.bind(function() {
                this._geocode(true);
              }, this),
              this.options.suggestTimeout
            );
          } else {
            this._clearResults();
          }
        }
      }
    }),
    factory: function(options) {
      return new L.Control.Geocoder(options);
    }
  };

  var HERE = {
    class: L.Class.extend({
      options: {
        geocodeUrl: 'http://geocoder.api.here.com/6.2/geocode.json',
        reverseGeocodeUrl: 'http://reverse.geocoder.api.here.com/6.2/reversegeocode.json',
        app_id: '<insert your app_id here>',
        app_code: '<insert your app_code here>',
        geocodingQueryParams: {},
        reverseQueryParams: {}
      },

      initialize: function(options) {
        L.setOptions(this, options);
      },

      geocode: function(query, cb, context) {
        var params = {
          searchtext: query,
          gen: 9,
          app_id: this.options.app_id,
          app_code: this.options.app_code,
          jsonattributes: 1
        };
        params = L.Util.extend(params, this.options.geocodingQueryParams);
        this.getJSON(this.options.geocodeUrl, params, cb, context);
      },

      reverse: function(location, scale, cb, context) {
        var params = {
          prox: encodeURIComponent(location.lat) + ',' + encodeURIComponent(location.lng),
          mode: 'retrieveAddresses',
          app_id: this.options.app_id,
          app_code: this.options.app_code,
          gen: 9,
          jsonattributes: 1
        };
        params = L.Util.extend(params, this.options.reverseQueryParams);
        this.getJSON(this.options.reverseGeocodeUrl, params, cb, context);
      },

      getJSON: function(url, params, cb, context) {
        getJSON(url, params, function(data) {
          var results = [],
            loc,
            latLng,
            latLngBounds;
          if (data.response.view && data.response.view.length) {
            for (var i = 0; i <= data.response.view[0].result.length - 1; i++) {
              loc = data.response.view[0].result[i].location;
              latLng = L.latLng(loc.displayPosition.latitude, loc.displayPosition.longitude);
              latLngBounds = L.latLngBounds(
                L.latLng(loc.mapView.topLeft.latitude, loc.mapView.topLeft.longitude),
                L.latLng(loc.mapView.bottomRight.latitude, loc.mapView.bottomRight.longitude)
              );
              results[i] = {
                name: loc.address.label,
                bbox: latLngBounds,
                center: latLng
              };
            }
          }
          cb.call(context, results);
        });
      }
    }),

    factory: function(options) {
      return new L.Control.Geocoder.HERE(options);
    }
  };

  var Geocoder = L.Util.extend(Control.class, {
    // Nominatim: Nominatim.class,
    // nominatim: Nominatim.factory,
    // Bing: Bing.class,
    // bing: Bing.factory,
    // MapQuest: MapQuest.class,
    // mapQuest: MapQuest.factory,
    // Mapbox: Mapbox.class,
    // mapbox: Mapbox.factory,
    // What3Words: What3Words.class,
    // what3words: What3Words.factory,
    // Google: Google.class,
    // google: Google.factory,
    // Photon: Photon.class,
    // photon: Photon.factory,
    // Mapzen: Mapzen.class,
    // GeocodeEarth: Mapzen.class,
    // Pelias: Mapzen.class,
    // mapzen: Mapzen.factory,
    // geocodeEarth: Mapzen.factory,
    // pelias: Mapzen.factory,
    // ArcGis: ArcGis.class,
    // arcgis: ArcGis.factory,
    HERE: HERE.class,
    here: HERE.factory
  });

  L.Util.extend(L.Control, {
    Geocoder: Geocoder,
    geocoder: Control.factory
  });

  return Geocoder;

}(L));
//# sourceMappingURL=Control.Geocoder.js.map
