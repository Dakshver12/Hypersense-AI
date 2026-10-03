// Modal focus containment and Escape behavior are provided by HTMLDialogElement.
export function confirmSkipQuestion(hasDraft = false) {
  return new Promise((resolve, reject) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'hypersense-confirm';
    dialog.setAttribute('aria-labelledby', 'skip-dialog-title');
    dialog.setAttribute('aria-describedby', 'skip-dialog-description');
    dialog.innerHTML = `<div class="confirm-eyebrow">INTERVIEW SESSION</div>
      <h2 id="skip-dialog-title">Skip this question?</h2>
      <p id="skip-dialog-description"></p>
      <p class="confirm-note">You can retry it from your session report. Your answer timer keeps running while this dialog is open.</p>
      <div class="confirm-actions">
        <button type="button" data-choice="keep" autofocus>Keep answering</button>
        <button type="button" data-choice="skip">Skip question</button>
      </div>`;
    dialog.querySelector('#skip-dialog-description').textContent = hasDraft
      ? 'Your current recording and transcript will be discarded. This question will be marked as skipped and excluded from your scores.'
      : 'This question will be marked as skipped and excluded from your scores.';
    let settled = false;
    const finish = accepted => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(accepted);
      setTimeout(() => { if (previousFocus?.isConnected) previousFocus.focus(); }, 0);
    };
    dialog.querySelector('[data-choice="keep"]').onclick = () => finish(false);
    dialog.querySelector('[data-choice="skip"]').onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
      dialog.querySelector('[data-choice="keep"]').focus();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}
