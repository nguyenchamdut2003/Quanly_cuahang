module.exports = {
  ...require('./page.controller'),
  ...require('./employee.controller'),
  ...require('./attendance.controller'),
  ...require('./payroll.controller'),
  ...require('./legacy.controller')
};
