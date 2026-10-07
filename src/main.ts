import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/bungee/latin-400.css';
import './styles/main.css';
import { Game } from './game/game';

const app = document.getElementById('app')!;
const game = new Game(app);
void game.boot();
// Handy from the console (and for automated screenshots).
(window as unknown as { game: Game }).game = game;
