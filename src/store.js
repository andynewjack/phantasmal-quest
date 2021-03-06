// @flow
import { observable } from 'mobx';
import { Object3D } from 'three';
import { Area, AreaVariant, Quest, VisibleQuestEntity } from './domain';

function area(id, name, order, variants) {
    const varis = Array(variants).fill().map((_, i) => new AreaVariant(i));
    const area = new Area(id, name, order, varis);

    for (const vari of varis) {
        vari.area = area;
    }

    return area;
}

class AreaStore {
    areas: Area[][];

    constructor() {
        // The IDs match the PSO IDs for areas.
        this.areas = [];
        let order = 0;
        this.areas[1] = [
            area(0, 'Pioneer II', order++, 1),
            area(1, 'Forest 1', order++, 1),
            area(2, 'Forest 2', order++, 1),
            area(11, 'Under the Dome', order++, 1),
            area(3, 'Cave 1', order++, 6),
            area(4, 'Cave 2', order++, 5),
            area(5, 'Cave 3', order++, 6),
            area(12, 'Underground Channel', order++, 1),
            area(6, 'Mine 1', order++, 6),
            area(7, 'Mine 2', order++, 6),
            area(13, 'Monitor Room', order++, 1),
            area(8, 'Ruins 1', order++, 5),
            area(9, 'Ruins 2', order++, 5),
            area(10, 'Ruins 3', order++, 5),
            area(14, 'Dark Falz', order++, 1)
        ];
        order = 0;
        this.areas[2] = [
            area(0, 'Lab', order++, 1),
            area(1, 'VR Temple Alpha', order++, 3),
            area(2, 'VR Temple Beta', order++, 3),
            area(14, 'VR Temple Final', order++, 1),
            area(3, 'VR Spaceship Alpha', order++, 3),
            area(4, 'VR Spaceship Beta', order++, 3),
            area(15, 'VR Spaceship Final', order++, 1),
            area(5, 'Central Control Area', order++, 1),
            area(6, 'Jungle Area East', order++, 1),
            area(7, 'Jungle Area North', order++, 1),
            area(8, 'Mountain Area', order++, 3),
            area(9, 'Seaside Area', order++, 1),
            area(12, 'Cliffs of Gal Da Val', order++, 1),
            area(10, 'Seabed Upper Levels', order++, 3),
            area(11, 'Seabed Lower Levels', order++, 3),
            area(13, 'Test Subject Disposal Area', order++, 1),
            area(16, 'Seaside Area at Night', order++, 1),
            area(17, 'Control Tower', order++, 5)
        ];
        order = 0;
        this.areas[4] = [
            area(0, 'Pioneer II (Ep. IV)', order++, 1),
            area(1, 'Crater Route 1', order++, 1),
            area(2, 'Crater Route 2', order++, 1),
            area(3, 'Crater Route 3', order++, 1),
            area(4, 'Crater Route 4', order++, 1),
            area(5, 'Crater Interior', order++, 1),
            area(6, 'Subterranean Desert 1', order++, 3),
            area(7, 'Subterranean Desert 2', order++, 3),
            area(8, 'Subterranean Desert 3', order++, 3),
            area(9, 'Meteor Impact Site', order++, 1)
        ];
    }

    get_variant(episode: number, area_id: number, variant_id: number) {
        if (episode !== 1 && episode !== 2 && episode !== 4)
            throw new Error(`Expected episode to be 1, 2 or 4, got ${episode}.`);

        const area = this.areas[episode].find(a => a.id === area_id);
        if (!area)
            throw new Error(`Area id ${area_id} for episode ${episode} is invalid.`);

        const area_variant = area.area_variants[variant_id];
        if (!area_variant)
            throw new Error(`Area variant id ${variant_id} for area ${area_id} of episode ${episode} is invalid.`);

        return area_variant;
    }
}

export const area_store = new AreaStore();

class ApplicationState {
    @observable current_model: ?Object3D = null;
    @observable current_quest: ?Quest = null;
    @observable current_area: ?Area = null;
    @observable selected_entity: ?VisibleQuestEntity = null;
}

export const application_state = new ApplicationState();
