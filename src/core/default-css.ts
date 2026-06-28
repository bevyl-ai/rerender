// Remotion injects a global reset wherever it mounts a composition. remover must
// match it for layout fidelity — `box-sizing: border-box` especially: a `width` +
// `border` element renders SMALLER in border-box than the browser's content-box
// default, so without this a bordered element comes out a few % too large vs Remotion.
let done = false;

export function injectRemoverCSS(): void {
  if (typeof document === 'undefined' || done) return;
  done = true;
  const style = document.createElement('style');
  style.textContent = '*{box-sizing:border-box;}body{margin:0;}';
  (document.head ?? document.documentElement).prepend(style);
}
