import { customElement } from 'aurelia';
import { Config } from "../../services/config-dev";
import template from './dashboard.html?raw';
import './dashboard.scss';

@customElement({ name: 'dashboard', template })
export class Dashboard {
    constructor(private _config: Config) {
        console.log("Using config", this._config);
    }
}
