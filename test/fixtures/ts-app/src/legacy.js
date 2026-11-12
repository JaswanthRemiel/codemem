const { UserService } = require('./service');

class LegacyLogin {
  service = UserService.create();

  handle = (req) => {
    return this.service.login(req.id, req.password);
  };
}

function oldLogin(req) {
  return new LegacyLogin().handle(req);
}

module.exports.oldLogin = oldLogin;
module.exports.health = function () {
  return 'ok';
};
