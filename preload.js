(function () {
  'use strict';
  var type = localStorage.getItem('ntwp-type');
  if (type === 'image' || type === 'bundled') {
    var data = localStorage.getItem('ntwp-data');
    if (data) {
      var style = document.createElement('style');
      style.id = 'wp-preload';
      style.textContent = '#photo-bg{background-image:url("' + data + '");opacity:1;transition:none}';
      document.head.appendChild(style);
    } else {
      document.documentElement.style.opacity = '0';
    }
  } else if (type === 'video' || type === 'gradient') {
    document.documentElement.style.opacity = '0';
    window._wpPreload = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('newtab-db', 1);
        req.onsuccess = function (e) {
          var db = e.target.result;
          var typeReq = db.transaction('wallpapers', 'readonly').objectStore('wallpapers').get('type');
          typeReq.onsuccess = function () {
            var t = typeReq.result;
            var dataReq = db.transaction('wallpapers', 'readonly').objectStore('wallpapers').get('data');
            dataReq.onsuccess = function () { resolve({ type: t, data: dataReq.result }); };
            dataReq.onerror = function () { resolve({ type: t, data: null }); };
          };
          typeReq.onerror = function () { resolve({ type: null, data: null }); };
        };
        req.onerror = function () { resolve({ type: null, data: null }); };
      } catch (err) { resolve({ type: null, data: null }); }
    });
  }
}());
