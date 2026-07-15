(function(){
  window.WALKOFF_CONFIG = Object.freeze({
    channel:'production',
    workerUrl:'https://still-resonance-4f87.swarnerauto.workers.dev',
    supabaseUrl:'https://vroknjrxubsqyexngwus.supabase.co',
    supabaseAnonKey:'sb_publishable_wbpX2nL8l-4NbXtZNG_bjA_nabSYaJ5',
    allowCloudWrites:true,
  });
  if(window.WALKOFF_CONFIG.channel === 'beta') {
    addEventListener('DOMContentLoaded', () => {
      const banner = document.createElement('div');
      banner.id = 'walkoff-beta-banner';
      banner.textContent = 'BETA · TEST DATA ONLY · NOT PRODUCTION';
      banner.style.cssText = 'position:fixed;z-index:999999;top:0;left:0;right:0;height:28px;display:grid;place-items:center;background:#ffb000;color:#130d00;font:800 11px/1 ui-monospace,monospace;letter-spacing:.12em;box-shadow:0 2px 8px #0008';
      document.body.appendChild(banner);
      document.body.style.paddingTop = '28px';
    }, { once:true });
  }
})();
