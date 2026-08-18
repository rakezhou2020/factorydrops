
document.addEventListener("click", function(e){
  const a = e.target.closest(".disabled-link");
  if(!a) return;
  e.preventDefault();
  const msg = a.parentElement.querySelector(".placeholder-msg") || document.querySelector("#global-placeholder");
  if(msg){
    msg.style.display = "block";
    setTimeout(()=>msg.style.display="none",2500);
  }
});
