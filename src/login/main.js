// Entry for the server's sign-in page (dist/login.html). It contains no LMS code or data:
// the LMS bundle is only served after the server has verified a session.
import './login.css';
import { mountLogin } from './view.js';

mountLogin(document.getElementById('app'), { mode: 'server' });
