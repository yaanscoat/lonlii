// applies the saved theme; pages without a theme stylesheet link just keep the default
const link = document.getElementById('css-theme-link');
const theme = localStorage.getItem('lonlii_theme') ?? 'default';

if (link) {
    link.href = theme !== 'default' ? `/assets/css/themes/${theme}.css` : '/assets/css/colors.css';
}
