(function(){
  try {
    const forward = (srcId, targetId) => {
      const src = document.getElementById(srcId);
      const tgt = document.getElementById(targetId);
      if (src && tgt) {
        src.addEventListener('click', () => tgt.click());
      }
    };

    // Forwarders for welcome/outline shortcuts → primary toolbar buttons
    forward('outline-load-zip-btn', 'course-load-btn');
    forward('welcome-load-zip-btn', 'course-load-btn');
    forward('welcome-folder-btn', 'course-folder-btn');
  } catch (_) {}
})();

