import {valueConverter} from 'aurelia';

@valueConverter('items')
export class ItemsConverter{
    toView(value: any[]){
        return [...value];
    }
}