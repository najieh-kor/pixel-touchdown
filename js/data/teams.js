/* Pixel Touchdown: js/data/teams.js
 * Owner: WP1. Responsibility: PT.Data.Teams: 32 team defs (city, name, abbr, colors, mascot species, conf/div).
 * Source: GAME_DESIGN.md 15.2 (exact). `sp` is the logo mascot only (rosters are mixed species, R2).
 */
(function (PT) {
  'use strict';
  const Teams = PT.ns('Data.Teams');

  Teams.CONFS = ['Sunny Conference', 'Frosty Conference'];
  Teams.CONF_SHORT = ['Sunny', 'Frosty'];
  Teams.DIVS = [['Highway', 'River', 'Farm', 'Desert'], ['Snowy', 'Forest', 'Railway', 'City']];
  /** Neutral site of the Pixel Bowl (design 15.2). */
  Teams.NEUTRAL = { stad: 'Pixel Dome', clim: 'dome' };

  // city | name | abbr | mascot | logo idea | pri | sec | offense style | defense style | tier | climate | stadium | rival abbr
  const RAW = [
    'Blacktop City|Blitz|BLZ|rabbit|a lightning bolt splitting a highway line|2B2D42|FFD23F|speed|wild|4|warm|The Overpass|CMT',
    'Sunset Strip|Comets|CMT|fox|a blazing comet over a sunset stripe|FF7B1C|FFFFFF|trick|think|3|warm|Comet Field|BLZ',
    'Toll Plaza|Bandits|BAN|raccoon|a masked bandit with a gold coin|5B5F97|FFC145|air|nofly|4|warm|Exact Change Arena|FRY',
    'Fender City|Fury|FRY|bull|a charging bull with steam from its nose|E63946|A8DADC|ground|wall|2|warm|Bumper Bowl|BAN',
    'Lily Lake|Leapers|LEA|frog|a frog mid-leap with a trail of sparkles|3BB273|F7D046|west|think|5|rainy|Lily Pad Park|LUM',
    'Log Landing|Lumberjacks|LUM|beaver|two crossed axes over a log|8B5A2B|4CC9F0|ground|wall|3|rainy|The Timber Yard|LEA',
    'Splash Falls|Rapids|RAP|duck|a curling wave with speed lines|0077B6|FFB703|speed|nofly|2|rainy|Whitewater Field|STO',
    'Puddle Town|Storm|STO|hamster|a thundercloud with a lightning bolt|48CAE4|FFD60A|air|wild|3|rainy|Splash Pad Park|RAP',
    'Corn Valley|Crushers|CRU|chicken|a fist smashing a corn cob|F9C74F|2D6A4F|ground|wild|3|mild|The Silo|TWI',
    'Haybale Hills|Twisters|TWI|goat|a spinning twister of hay|E9C46A|9C2C2C|speed|wild|3|mild|Twister Field|CRU',
    'Red Barn|Barnstormers|BRN|pig|a red barn with a stunt plane overhead|C1121F|FDF0D5|west|wall|4|mild|The Big Barn|TRA',
    'Turnip Patch|Tractors|TRA|turtle|a monster-truck tractor doing a wheelie|55A630|F4F1DE|trick|think|1|mild|Mud Track Stadium|BRN',
    'Cactus Crossing|Spikes|SPK|kangaroo|a spiky cactus shaped like a fist|2A9D8F|F4A261|air|think|3|warm|Prickly Park|DUS',
    'Tumbleweed Gulch|Dusters|DUS|ostrich|a tumbleweed kicking up a dust cloud|C08552|5E3023|trick|wild|2|warm|Dust Devil Field|SPK',
    'Mirage Mesa|Sandsharks|SND|cheetah|a shark fin cutting through sand|F2CC8F|E07A5F|speed|nofly|1|warm|Sandbox Stadium|HEA',
    'Oasis Springs|Heat|HEA|lion|a blazing sun with a roaring mane|FF9F1C|E71D36|west|wall|4|warm|The Hot Plate|SND',
    'Snowcone Peak|Avalanche|AVA|walrus|a snowball rolling down a mountain|FFC300|003566|ground|wall|5|cold|Avalanche Arena|FLP',
    'Igloo Village|Flippers|FLP|penguin|a penguin flipping off an ice block|A2D2FF|1D3557|west|think|3|dome|The Big Igloo|AVA',
    'Frostbite Falls|Fangs|FNG|wolf|an ice-blue wolf head with fangs|CAF0F8|7209B7|trick|wild|2|cold|Icicle Arena|ROC',
    'Sled Hill|Rockets|ROC|squirrel|a rocket sled with flames|D62828|EAE2B7|air|nofly|3|cold|Downhill Bowl|FNG',
    'Pinecone Hollow|Grizzlies|GRZ|bear|a grizzly paw print on a pinecone|6F4518|A7C957|air|wild|3|cold|The Canopy|SAW',
    'Lumber Lake|Sawblades|SAW|moose|a spinning saw blade|9C6644|BDE0FE|ground|wall|4|cold|Sawdust Stadium|GRZ',
    'Mossy Glen|Guardians|GRD|panda|a stone shield wrapped in moss|386641|F2E8CF|west|think|1|cold|Stump Field|TAL',
    'Eagle Ridge|Talons|TAL|eagle|an eagle diving with talons out|14213D|FCA311|speed|nofly|4|cold|The Nest|GRD',
    'Junction City|Express|EXP|gorilla|a voxel train engine bursting through a sign|343A40|F94144|ground|wild|4|cold|Roundhouse Stadium|CON',
    'Caboose Creek|Conductors|CON|monkey|a conductor cap over crossed rails|9D0208|FFBA08|west|wall|3|cold|Last Car Field|EXP',
    'Signal Hill|Sirens|SIR|owl|a flashing red signal light|F1FAEE|E63946|trick|think|2|cold|Crossing Gate Park|STM',
    'Coal Canyon|Steamrollers|STM|rhino|a steamroller with a puff of smoke|495057|90E0EF|air|wall|3|cold|The Boiler Room|SIR',
    'Neon Blocks|Crosswalk Kings|CWK|cat|a crown on top of zebra-crossing stripes|7B2CBF|F8F9FA|air|nofly|5|dome|Neon Dome|TRB',
    'Metro Heights|Turbos|TRB|dog|a turbo engine with motion streaks|FFD000|212529|speed|wild|3|mild|Gridlock Garden|CWK',
    'Gridlock Grove|Mayhem|MAY|crab|a crab claw cracking a traffic light|3A86FF|FB5607|ground|wall|2|mild|The Roundabout|WRK',
    'Scrap Heap Alley|Wreckers|WRK|hippo|a wrecking ball with a hippo grin|8D7B68|F77F00|trick|wild|2|mild|Scrap Yard Stadium|MAY'
  ].map((s) => s.split('|'));

  /** accent color: white on dark primaries, ink on light ones */
  function accent(pri) {
    const lum = 0.299 * ((pri >> 16) & 255) + 0.587 * ((pri >> 8) & 255) + 0.114 * (pri & 255);
    return lum < 110 ? 0xffffff : 0x1b1f3a;
  }

  /** [{ id, city, name, abbr, sp, logo, col:{pri,sec,acc}, conf, div, style:{off,def}, tier, clim, stad, rival }] ×32, index = id */
  Teams.list = RAW.map((t, i) => {
    const pri = parseInt(t[5], 16), sec = parseInt(t[6], 16);
    return {
      id: i, city: t[0], name: t[1], abbr: t[2], sp: t[3], logo: t[4],
      col: { pri: pri, sec: sec, acc: accent(pri) },
      conf: Math.floor(i / 16), div: Math.floor((i % 16) / 4),
      style: { off: t[7], def: t[8] }, tier: +t[9], clim: t[10], stad: t[11],
      rival: RAW.findIndex((x) => x[2] === t[12])
    };
  });

  Teams.byId = (id) => Teams.list[id] || null;
  Teams.byAbbr = (abbr) => Teams.list.find((t) => t.abbr === abbr) || null;
  /** 'Highway Division' */
  Teams.divName = (conf, div) => Teams.DIVS[conf][div] + ' Division';
})(globalThis.PT = globalThis.PT || {});
