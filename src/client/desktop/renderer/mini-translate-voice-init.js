// Add voice input to the Quick Translate textarea.
// External file because the page CSP (script-src 'self') refuses inline scripts.
document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('textInput');
    if (textInput && typeof addVoiceInput === 'function') addVoiceInput(textInput);
});
