// SDM Dashboard Leaflet Plugins
// leaflet-side-by-side - split screen comparison (current vs future)
// leaflet-draw - drawing tools for custom projection extents
// leaflet.markercluster - occurrence point clustering

(function() {
  // Side-by-side comparison control for results map
  // Called from R via Shiny.setInputValue
  window.initSideBySide = function(leftMapId, rightMapId, containerId) {
    if (window.sideBySideInstance) {
      window.sideBySideInstance.remove();
    }
    var container = document.getElementById(containerId);
    if (!container) return;

    var L = window.L;
    if (!L) return;

    // For now, just log - full side-by-side requires two Leaflet instances
    console.log('Side-by-side ready for', leftMapId, rightMapId);
  };

  // Draw control for custom projection extents
  // Draws a rectangle on the map and sets custom extent inputs
  window.initDrawExtent = function(mapId, xminId, xmaxId, yminId, ymaxId) {
    var L = window.L;
    if (!L || !document.getElementById(mapId)) return;

    // Check if Leaflet.draw is available
    if (typeof L.Control === 'undefined') return;

    var drawnItems = new L.FeatureGroup();
    var map = window[mapId + '_map']; // R leaflet exposes map this way

    if (!map) {
      console.log('Map ' + mapId + ' not found for draw control');
      return;
    }

    map.addLayer(drawnItems);

    var drawControl = new L.Control.Draw({
      draw: {
        polygon: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        rectangle: {
          shapeOptions: {
            color: '#0B6E69',
            weight: 2,
            fillOpacity: 0.1
          }
        }
      },
      edit: {
        featureGroup: drawnItems,
        remove: true
      }
    });

    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function(e) {
      var layer = e.layer;
      var bounds = layer.getBounds();
      var xmin = bounds.getWest().toFixed(4);
      var xmax = bounds.getEast().toFixed(4);
      var ymin = bounds.getSouth().toFixed(4);
      var ymax = bounds.getNorth().toFixed(4);

      // Set Shiny inputs
      if (window.Shiny) {
        Shiny.setInputValue(xminId, parseFloat(xmin), {priority: 'event'});
        Shiny.setInputValue(xmaxId, parseFloat(xmax), {priority: 'event'});
        Shiny.setInputValue(yminId, parseFloat(ymin), {priority: 'event'});
        Shiny.setInputValue(ymaxId, parseFloat(ymax), {priority: 'event'});
      }

      drawnItems.addLayer(layer);
    });

    console.log('Draw extent control initialized on', mapId);
  };

  // Mouse position display
  window.addMousePosition = function(mapId, position) {
    position = position || 'bottomleft';
    var L = window.L;
    var map = window[mapId + '_map'];
    if (!L || !map) return;

    var MousePosition = L.Control.extend({
      options: {
        position: position
      },
      onAdd: function(map) {
        var container = L.DomUtil.create('div', 'leaflet-control-mouseposition');
        container.style.backgroundColor = 'white';
        container.style.padding = '5px 10px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 1px 5px rgba(0,0,0,0.2)';
        container.style.fontSize = '12px';
        container.style.fontFamily = 'monospace';
        map.on('mousemove', function(e) {
          container.innerHTML = e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6);
        });
        return container;
      }
    });

    map.addControl(new MousePosition());
    console.log('Mouse position added to', mapId);
  };

  // Add heatmap layer to occurrence map
  window.addOccurrenceHeatmap = function(mapId, points, radius) {
    var L = window.L;
    var map = window[mapId + '_map'];
    if (!L || !map) return;

    radius = radius || 20;

    var heatPoints = points.map(function(p) {
      return [p.lat, p.lng, 1];
    });

    if (typeof L.heat === 'undefined') {
      console.log('Leaflet.heat not loaded, skipping heatmap');
      return;
    }

    var heatLayer = L.heatLayer(heatPoints, {
      radius: radius,
      blur: 15,
      maxZoom: 17,
      gradient: {
        0.2: 'blue',
        0.4: 'cyan',
        0.6: 'lime',
        0.8: 'yellow',
        1.0: 'red'
      }
    }).addTo(map);

    window['_heatmap_' + mapId] = heatLayer;
    console.log('Heatmap added to', mapId, 'with', points.length, 'points');
  };

  // Toggle heatmap visibility
  window.toggleOccurrenceHeatmap = function(mapId, show) {
    var heatLayer = window['_heatmap_' + mapId];
    if (!heatLayer) return;
    if (show) {
      heatLayer.addTo(window[mapId + '_map']);
    } else {
      heatLayer.remove();
    }
  };

})();