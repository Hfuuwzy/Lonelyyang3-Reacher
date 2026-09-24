export default defineNuxtPlugin(() => {
  const savedTheme = localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = savedTheme === 'dark' || (savedTheme === null && prefersDark)

  document.documentElement.classList.toggle('dark', isDark)
})
