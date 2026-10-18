export const bootedSessionKey = "shadow-cloud:booted";

export const hideBootSplashScript = `try{if(sessionStorage.getItem("${bootedSessionKey}")||matchMedia("(prefers-reduced-motion: reduce)").matches){var s=document.createElement("style");s.textContent="[data-boot-splash]{display:none}";document.head.appendChild(s)}}catch(e){}`;
