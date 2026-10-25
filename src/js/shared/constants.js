export const COURT = {
  HALF_LENGTH: 6.70,
  HALF_WIDTH: 2.59,
  DOUBLES_HALF_WIDTH: 3.05,
  NET_CENTER: 1.524,
  NET_POST: 1.550,
  NET_HALF_WIDTH: 3.05,
  SHORT_SERVICE: 1.98,
  LONG_SERVICE_DOUBLES: 5.94,
  LINE_HALF_WIDTH: 0.045,
};

export const PHYS = {
  G: 9.81,
  DRAG: 0.132,
  SUBSTEP: 1 / 240,
  MAX_STEP: 0.05,
};

export const BALL = {
  R: 0.032,
  NET_BOUNCE: 0.12,
};

export const PLAYER = {
  HEIGHT: 1.78,
  MOVE_SPEED: 5.55,
  ACCEL: 42,
  DECEL: 34,
  JUMP_V: 4.18,
  REACH_X: 0.92,
  REACH_UP: 2.44,
  REACH_DOWN: 0.08,
  CHARGE_TIME: 0.70,
  SWING_CD: 0.14,
  LUNGE_LEAD: 0.24,
};

export const RULES = {
  TARGET_POINTS: 11,
  WIN_BY: 2,
  HARD_CAP: 15,
  SERVE_HEIGHT: 1.14,
  SERVE_DIST: 0.74,
  POINT_PAUSE: 1.75,
};

export const SHOT = {
  CLEAR: 'clear',
  LIFT: 'lift',
  DROP: 'drop',
  NET: 'net',
  DRIVE: 'drive',
  SMASH: 'smash',
  SERVE_LOW: 'serveLow',
  SERVE_HIGH: 'serveHigh',
};

export const SHOT_LABEL = {
  clear: '高远球',
  lift: '挑球',
  drop: '吊球',
  net: '网前搓球',
  drive: '平抽',
  smash: '杀球',
  serveLow: '发短球',
  serveHigh: '发高远球',
};

export const COLORS = {
  left: '#ff7a4d',
  leftSoft: '#ffb59a',
  right: '#37d6ff',
  rightSoft: '#a5ecff',
};
