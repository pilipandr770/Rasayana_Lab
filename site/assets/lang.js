(function(){
  var saved = null;
  try { saved = localStorage.getItem('rasayana_lang'); } catch(e) {}
  document.documentElement.setAttribute('data-lang', saved || 'uk');
})();
function setLang(lang){
  document.documentElement.setAttribute('data-lang', lang);
  try { localStorage.setItem('rasayana_lang', lang); } catch(e) {}
  document.querySelectorAll('.lang-btn').forEach(function(b){
    b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
  });
}
document.addEventListener('DOMContentLoaded', function(){
  var cur = document.documentElement.getAttribute('data-lang') || 'uk';
  document.querySelectorAll('.lang-btn').forEach(function(b){
    b.setAttribute('aria-pressed', b.dataset.lang === cur ? 'true' : 'false');
  });
});
