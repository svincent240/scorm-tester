(function(){
  try {
    const toolbarZip = () => document.getElementById('course-load-btn');
    const toolbarFolder = () => document.getElementById('course-folder-btn');

    document.addEventListener('click', (e) => {
      const zipBtn = e.target.closest('.js-load-zip');
      if (zipBtn) { const t = toolbarZip(); if (t) t.click(); return; }

      const folderBtn = e.target.closest('.js-load-folder');
      if (folderBtn) { const t = toolbarFolder(); if (t) t.click(); }
    });
  } catch (_) {}
})();

