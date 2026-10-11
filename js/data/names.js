/* Pixel Touchdown: js/data/names.js
 * Owner: WP1. Responsibility: PT.Data.Names: first/last name pools (cute/punny), per species flavor.
 * Source: GAME_DESIGN.md Appendix A (64 first, 64 last, 20 schools) + small per-species last-name flavor lists.
 */
(function (PT) {
  'use strict';
  const Names = PT.ns('Data.Names');

  Names.FIRST = ['Biscuit', 'Pickles', 'Waffles', 'Nugget', 'Pebble', 'Sprout', 'Mochi', 'Bean', 'Clover', 'Tater', 'Noodle',
    'Peanut', 'Muffin', 'Ziggy', 'Bubbles', 'Rocco', 'Pepper', 'Toffee', 'Juniper', 'Bongo', 'Doodle', 'Fizz', 'Gus', 'Hazel',
    'Jellybean', 'Kiwi', 'Lulu', 'Maple', 'Nibbles', 'Olive', 'Pudding', 'Quincy', 'Rusty', 'Sunny', 'Taco', 'Umi', 'Velvet',
    'Wally', 'Yoyo', 'Zuzu', 'Acorn', 'Barley', 'Cocoa', 'Dumpling', 'Echo', 'Fudge', 'Gizmo', 'Honey', 'Indigo', 'Jinx', 'Koko',
    'Lentil', 'Marbles', 'Nacho', 'Oreo', 'Pip', 'Rascal', 'Scooter', 'Truffle', 'Waffle Jr.', 'Bolt', 'Chip', 'Dash', 'Sparky'];

  Names.LAST = ['Puddlefoot', 'McHop', 'Thunderpaws', 'Fluffington', 'Crumbs', 'Bigsby', 'Snoot', 'Wigglesworth', 'Featherstone',
    'Mudsley', 'Quackers', 'Hoofington', 'Tumble', 'Stompers', 'Whiskerton', 'Bouncewell', 'Cobblestone', 'Dandelion', 'Fernsby',
    'Gumdrop', 'Hopscotch', 'Jumbleton', 'Kettlecorn', 'Lollipop', 'Moonbeam', 'Nutterby', 'Oddsock', 'Pinwheel', 'Quickstep',
    'Roadrunner', 'Sprinkles', 'Tidepool', 'Underbridge', 'Velcro', 'Wobbleton', 'Yardley', 'Zoomer', 'Bramble', 'Crosswalk',
    'Driftwood', 'Flapjack', 'Gravelpit', 'Honkers', 'Inchworm', 'Jalopy', 'Lilypad', 'Mapleleaf', 'Nimblefoot', 'Pothole',
    'Railsby', 'Sandcastle', 'Tollbooth', 'Waddle', 'Bumper', 'Cattail', 'Haystack', 'Iceberg', 'Logroll', 'Mufflers', 'Pinecone',
    'Snowdrift', 'Tailgate', 'Turnpike', 'Woodchuck'];

  Names.SCHOOLS = ['Acorn U', 'Pond State', 'Hay Bale Tech', 'Puddle College', 'Big Rock U', 'Sandy Shores State', 'Pinecone Prep',
    'Riverbend U', 'Corn Cob College', 'Frosty Peak State', 'Junkyard Tech', 'Crosswalk Academy', 'Lily Pad U',
    'Desert Wind College', 'Mudflats State', 'Railyard U', 'Snowball State', 'Cloud Valley U', 'Toll Road Tech', 'Meadowbrook College'];

  /** Extra species-flavored last names (used 20% of the time) */
  Names.FLAVOR = {
    elephant: ['Trunkworth', 'Peanutbottom'], rhino: ['Hornsby', 'Stompington'], hippo: ['Wallowby', 'Riverbottom'],
    bear: ['Honeypaw', 'Grizzlewood'], gorilla: ['Bananafist', 'Knucklebee'], walrus: ['Tuskworth', 'Floebottom'],
    moose: ['Antlerby', 'Pinestomp'], bull: ['Hoofstorm', 'Snortley'], panda: ['Bamboozle', 'Bambooster'],
    lion: ['Maneworth', 'Roarington'], croc: ['Chompers', 'Snapjaw'], giraffe: ['Longneck', 'Treetopper'],
    ostrich: ['Plumewood', 'Sandstrider'], penguin: ['Tuxbury', 'Icewaddle'], owl: ['Hootsworth', 'Nightfeather'],
    fox: ['Bushtail', 'Sly'], wolf: ['Howlett', 'Moonfang'], cheetah: ['Spotsworth', 'Zippity'],
    kangaroo: ['Pouchley', 'Boingston'], turtle: ['Shellby', 'Slowpoke'], dog: ['Barkley', 'Wagsworth'],
    pig: ['Oinkley', 'Truffleton'], goat: ['Bleatwood', 'Cliffhopper'], eagle: ['Talonby', 'Skyswoop'],
    beaver: ['Dambuilder', 'Chewbark'], raccoon: ['Trashpanda', 'Maskwell'], monkey: ['Banana', 'Vineswing'],
    rabbit: ['Carrotby', 'Hopwell'], frog: ['Ribbitson', 'Lilyleap'], chicken: ['Cluckston', 'Roadcross'],
    duck: ['Quackenbush', 'Puddleduck'], cat: ['Whiskers', 'Purrington'], hamster: ['Wheelie', 'Cheekfull'],
    crab: ['Pinchley', 'Sideways'], squirrel: ['Acornby', 'Nutkins']
  };

  /** @param {Object} rng PT.RNG instance @param {string} [sp] species id */
  Names.first = (rng, sp) => rng.pick(Names.FIRST);
  Names.last = (rng, sp) => (sp && Names.FLAVOR[sp] && rng.chance(0.2) ? rng.pick(Names.FLAVOR[sp]) : rng.pick(Names.LAST));
  Names.school = (rng) => rng.pick(Names.SCHOOLS);
  /** default coach name: 'Coach Waffles' (Appendix A) */
  Names.coach = (rng) => 'Coach ' + rng.pick(Names.FIRST);
})(globalThis.PT = globalThis.PT || {});
