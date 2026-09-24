---
title: MySQL基础教程
description: 本文介绍了MySQL的基础知识，包括数据库操作、表操作、查询语句等。
date: 2023-04-20
category: 技术
tags: [MySQL, 数据库]
cover: /images/reference/deaimon/cover-mysql.jpg
---

# MySQL基础教程

本文介绍了MySQL的基础知识，包括数据库操作、表操作、查询语句等。

## 数据库操作

```sql
-- 创建数据库
CREATE DATABASE mydb;

-- 使用数据库
USE mydb;

-- 删除数据库
DROP DATABASE mydb;
```

## 表操作

```sql
-- 创建表
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入数据
INSERT INTO users (name, email) VALUES ('张三', 'zhangsan@example.com');

-- 查询数据
SELECT * FROM users WHERE name = '张三';
```

## 总结

MySQL是一个功能强大的关系型数据库，掌握这些基础操作是学习其他高级特性的前提。
