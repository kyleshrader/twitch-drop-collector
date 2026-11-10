/* global document */
// The dark vs light comparison: the range input moves the divide.
for (const compare of document.querySelectorAll('[data-compare]')) {
  const input = compare.querySelector('input')
  const set = () => compare.style.setProperty('--at', `${input.value}%`)
  input.addEventListener('input', set)
  set()
}
