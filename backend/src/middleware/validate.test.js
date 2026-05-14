const { validateTask } = require('./validate');

describe('Тестирование валидации задач (Task Validation)', () => {
  let mockRequest;
  let mockResponse;
  let nextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
  });

  test('Успешный сценарий: Должен пропустить валидную задачу', () => {
    mockRequest.body = { title: 'Написать документацию', tag: 'qa', column_id: 'todo' };
    
    validateTask(mockRequest, mockResponse, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
  });

  test('Негативный сценарий: Должен вернуть 400, если заголовок пустой', () => {
    mockRequest.body = { title: '', tag: 'frontend', column_id: 'todo' };
    
    validateTask(mockRequest, mockResponse, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('title is required') })
    );
  });

  test('Негативный сценарий: Должен выдать ошибку на недопустимый тег', () => {
    mockRequest.body = { title: 'Исправить баг', tag: 'shokolad', column_id: 'todo' };
    
    validateTask(mockRequest, mockResponse, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(400);
  });

  test('Успешный сценарий: Все валидные теги должны пройти', () => {
    const validTags = ['frontend', 'backend', 'design', 'devops', 'qa'];
    validTags.forEach(tag => {
      nextFunction.mockClear();
      mockRequest.body = { title: 'Test', tag, column_id: 'todo' };
      validateTask(mockRequest, mockResponse, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  test('Успешный сценарий: Все валидные колонны должны пройти', () => {
    const validCols = ['todo', 'inprog', 'review', 'done'];
    validCols.forEach(col => {
      nextFunction.mockClear();
      mockRequest.body = { title: 'Test', tag: 'frontend', column_id: col };
      validateTask(mockRequest, mockResponse, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  test('Негативный сценарий: Недопустимая колонна должна вернуть 400', () => {
    mockRequest.body = { title: 'Test', tag: 'frontend', column_id: 'invalid' };
    
    validateTask(mockRequest, mockResponse, nextFunction);
    
    expect(mockResponse.status).toHaveBeenCalledWith(400);
  });
});
