/* Icon loại thiết bị (nét lucide 1.75) dưới dạng React element cho prop `icon` của DeviceNet.DeviceTile */
(function () {
  var P = {
    plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8H6v4a6 6 0 0 0 12 0V8z'],
    toggle: ['M8 5h8a7 7 0 0 1 0 14H8A7 7 0 0 1 8 5z', 'M8 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    bulb: ['M9 18h6', 'M10 22h4', 'M15.1 14c.6-.7 1.9-1.6 1.9-4a5 5 0 0 0-10 0c0 2.4 1.3 3.3 1.9 4 .4.5.6 1.2.6 2h5c0-.8.2-1.5.6-2z'],
    temp: ['M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0z'],
    fan: ['M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M12 10V4a3 3 0 0 1 3 3', 'M14 12h6a3 3 0 0 1-3 3', 'M12 14v6a3 3 0 0 1-3-3', 'M10 12H4a3 3 0 0 1 3-3'],
    zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
    motion: ['M19.07 4.93A10 10 0 0 0 6.99 3.34', 'M4 6h.01', 'M2.29 9.62A10 10 0 1 0 21.31 8.35', 'M16.24 7.76A6 6 0 1 0 8.23 16.67', 'M12 18h.01', 'M17.99 11.66A6 6 0 0 1 15.77 16.67', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'm13.41 10.59 5.66-5.66'],
    door: ['M13 4h3a2 2 0 0 1 2 2v14', 'M2 20h3', 'M13 20h9', 'M10 12v.01', 'M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z'],
    router: ['M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M6 18h.01', 'M10 18h.01', 'M15 10v4', 'M17.84 7.17a4 4 0 0 0-5.66 0', 'M20.66 4.34a8 8 0 0 0-11.31 0']
  };
  window.dnIcon = function (name) {
    var R = window.React;
    return R.createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      (P[name] || P.plug).map(function (d, i) { return R.createElement('path', { key: i, d: d }); }));
  };
})();
