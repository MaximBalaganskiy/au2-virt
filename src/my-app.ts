import { customElement } from 'aurelia';
import { Dashboard } from './components/dashboard/dashboard';
import template from './my-app.html?raw';
import './my-app.scss';

@customElement({ name: 'my-app', template })
export class MyApp {
    static routes = [{ component: Dashboard, title: 'Dashboard', path: 'dashboard' }];
    routes = MyApp.routes;
}
