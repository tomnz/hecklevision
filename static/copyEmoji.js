// Copying text that contains custom (Slack) emoji images puts their :name: codes on the
// clipboard, so they survive being pasted back into a heckle or into Slack. Built-in
// emoji are real characters and copy normally.
document.addEventListener('copy', (event) => {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !event.clipboardData) {
    return;
  }

  const holderEl = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    holderEl.appendChild(selection.getRangeAt(i).cloneContents());
  }
  const imageEls = holderEl.querySelectorAll('img.customEmoji');
  if (imageEls.length === 0) {
    return;
  }

  const html = holderEl.innerHTML;
  imageEls.forEach((imageEl) => imageEl.replaceWith(`:${imageEl.alt}:`));

  // innerText (unlike textContent) keeps line breaks between blocks, but only works on
  // rendered elements, so briefly attach the copy off screen
  holderEl.style.cssText = 'position: fixed; left: -9999px; top: 0; white-space: pre-wrap;';
  document.body.appendChild(holderEl);
  const text = holderEl.innerText;
  holderEl.remove();

  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', html);
  event.preventDefault();
});
