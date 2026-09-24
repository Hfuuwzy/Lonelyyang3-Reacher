<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="site-footer__copyright">© {{ currentYear }} MyWorks. All rights reserved.</p>
      <p class="site-footer__note">在和纸般的页面上，收录作品、技术与日常。</p>
      <a class="site-footer__rss" href="/atom.xml" target="_blank" rel="noopener noreferrer">RSS</a>
    </div>
  </footer>
</template>

<script setup lang="ts">
const currentYear = new Date().getFullYear()
</script>

<style scoped src="./footer.css"></style>
