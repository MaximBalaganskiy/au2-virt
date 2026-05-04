import Aurelia from 'aurelia';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import { AllConfiguration } from '@aurelia-mdc-web/all';
import { Dashboard } from './components/dashboard/dashboard';
import { DefaultVirtualizationConfiguration } from '@aurelia/ui-virtualization';
import {ItemsConverter} from './components/dashboard/items-converter';

Aurelia
  .register(
    DefaultVirtualizationConfiguration,
    RouterConfiguration.customize({
      useUrlFragmentHash: true,
      useHref: false
    }),
    AllConfiguration,
    ItemsConverter
  )
  .register(Dashboard)
  // To use HTML5 pushState routes, replace previous line with the following
  // customized router config.
  // .register(RouterConfiguration.customize({ useUrlFragmentHash: false }))
  .app(MyApp)
  .start();
