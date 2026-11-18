import DefaultTheme from 'vitepress/theme';
import ViewerFigure from './ViewerFigure.vue';
import './style.css';
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) { app.component('ViewerFigure', ViewerFigure); },
};
